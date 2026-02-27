import { NextResponse } from "next/server";
import { execSync } from "child_process";

// Known local base paths for orgs — extend as needed
const LOCAL_BASE: Record<string, string> = {
  cbroberg:     "/Users/cb/Apps/cbroberg",
  webhousecode: "/Users/cb/Apps/webhouse",
};

export interface GithubOrg {
  login: string;
  name: string;
  localBase: string | null;
  isPersonal: boolean;
}

export async function GET() {
  try {
    const user = JSON.parse(
      execSync("gh api /user --jq '{login,name}'", { encoding: "utf-8", timeout: 8_000 })
    ) as { login: string; name: string };

    const orgs = JSON.parse(
      execSync("gh api /user/orgs --jq '[.[] | {login, name: (.name // .login)}]'", {
        encoding: "utf-8",
        timeout: 8_000,
      })
    ) as Array<{ login: string; name: string }>;

    const result: GithubOrg[] = [
      {
        login: user.login,
        name: `${user.name} (personal)`,
        localBase: LOCAL_BASE[user.login] ?? null,
        isPersonal: true,
      },
      ...orgs.map(o => ({
        login: o.login,
        name: o.name,
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
