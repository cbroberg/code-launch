import { NextResponse } from "next/server";

export interface FlyApp {
  name: string;
  org: "personal" | "webhouse" | string;
  status: "deployed" | "suspended" | "pending" | string;
  hostname: string;
  appUrl: string;
  latestDeploy: string | null;
}

const FLY_GQL = "https://api.fly.io/graphql";

const APPS_QUERY = `
  query ListApps {
    apps(first: 400) {
      nodes {
        name
        status
        hostname
        appUrl
        organization { slug }
        currentRelease { createdAt }
      }
    }
  }
`;

export async function GET() {
  const token = process.env.FLY_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { apps: [], error: "FLY_API_TOKEN not configured" },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(FLY_GQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: APPS_QUERY }),
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`Fly API: ${res.status}`);

    const json = (await res.json()) as {
      data?: {
        apps: {
          nodes: Array<{
            name: string;
            status: string;
            hostname: string;
            appUrl: string;
            organization: { slug: string } | null;
            currentRelease: { createdAt: string } | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) throw new Error(json.errors[0].message);

    const nodes = json.data?.apps.nodes ?? [];
    const flyApps: FlyApp[] = nodes.map((a) => ({
      name: a.name,
      org: a.organization?.slug ?? "personal",
      status: a.status || "unknown",
      hostname: a.hostname,
      appUrl: a.appUrl || `https://${a.hostname}`,
      latestDeploy: a.currentRelease?.createdAt ?? null,
    }));

    return NextResponse.json({ apps: flyApps });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ apps: [], error: msg }, { status: 500 });
  }
}
