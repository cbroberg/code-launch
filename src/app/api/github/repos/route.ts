import { NextResponse } from "next/server";
import { execSync } from "child_process";
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

  try {
    // Fetch all registered local paths to check which repos are already cloned
    const registered = await db.select({ githubName: apps.githubName }).from(apps);
    const registeredSet = new Set(registered.map(r => r.githubName).filter(Boolean));

    const isPersonal = searchParams.get("personal") === "1";
    const endpoint = isPersonal
      ? `/user/repos?type=owner&sort=updated&per_page=100`
      : `/orgs/${org}/repos?sort=updated&per_page=100`;

    const raw = execSync(
      `gh api "${endpoint}" --jq '[.[] | {name, full_name, private, description, pushed_at, language}]'`,
      { encoding: "utf-8", timeout: 15_000 }
    );

    const repos = JSON.parse(raw) as Array<{
      name: string;
      full_name: string;
      private: boolean;
      description: string | null;
      pushed_at: string | null;
      language: string | null;
    }>;

    const result: GithubRepo[] = repos.map(r => ({
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
