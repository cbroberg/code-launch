import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Known local base paths for orgs — extend as needed
const LOCAL_BASE: Record<string, string> = {
  cbroberg: "/Users/cb/Apps/cbroberg",
  webhousecode: "/Users/cb/Apps/webhouse",
};

export interface GithubOrg {
  login: string;
  name: string;
  localBase: string | null;
  isPersonal: boolean;
}

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function GET() {
  const session = await auth();
  const token =
    (session as typeof session & { accessToken?: string })?.accessToken ??
    process.env.GITHUB_TOKEN;

  if (!token) {
    return NextResponse.json(
      { orgs: [], error: "No GitHub token available" },
      { status: 503 }
    );
  }

  try {
    const [user, orgs] = await Promise.all([
      ghFetch<{ login: string; name: string }>("/user", token),
      ghFetch<Array<{ login: string; name: string }>>("/user/orgs", token),
    ]);

    const result: GithubOrg[] = [
      {
        login: user.login,
        name: `${user.name ?? user.login} (personal)`,
        localBase: LOCAL_BASE[user.login] ?? null,
        isPersonal: true,
      },
      ...orgs.map((o) => ({
        login: o.login,
        name: o.name ?? o.login,
        localBase: LOCAL_BASE[o.login] ?? null,
        isPersonal: false,
      })),
    ];

    return NextResponse.json({ orgs: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ orgs: [], error: msg }, { status: 500 });
  }
}
