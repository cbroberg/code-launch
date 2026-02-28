import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";

export interface GithubRepo {
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  pushedAt: string | null;
  language: string | null;
  isAlreadyCloned: boolean;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org required" }, { status: 400 });

  const session = await auth();
  const token =
    (session as typeof session & { accessToken?: string })?.accessToken ??
    process.env.GITHUB_TOKEN;

  if (!token) {
    return NextResponse.json(
      { repos: [], error: "No GitHub token available" },
      { status: 503 }
    );
  }

  try {
    const registered = await db.select({ githubName: apps.githubName }).from(apps);
    const registeredSet = new Set(registered.map((r) => r.githubName).filter(Boolean));

    const isPersonal = searchParams.get("personal") === "1";
    const endpoint = isPersonal
      ? "/user/repos?type=owner&sort=updated&per_page=100"
      : `/orgs/${org}/repos?sort=updated&per_page=100`;

    const res = await fetch(`https://api.github.com${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);

    const repos = (await res.json()) as Array<{
      name: string;
      full_name: string;
      private: boolean;
      description: string | null;
      pushed_at: string | null;
      language: string | null;
    }>;

    const result: GithubRepo[] = repos.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      description: r.description,
      pushedAt: r.pushed_at,
      language: r.language,
      isAlreadyCloned: registeredSet.has(r.full_name),
    }));

    return NextResponse.json({ repos: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ repos: [], error: msg }, { status: 500 });
  }
}
