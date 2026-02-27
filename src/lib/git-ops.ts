import { execSync } from "child_process";

export function gitCommitPortChange(
  localPath: string,
  writtenFiles: string[],
  newPort: number
): { committed: boolean; pushed: boolean } {
  if (writtenFiles.length === 0) return { committed: false, pushed: false };

  try {
    for (const f of writtenFiles) {
      execSync(`git -C "${localPath}" add "${f}"`, { encoding: "utf-8" });
    }
    execSync(
      `git -C "${localPath}" commit -m "chore: update dev port to ${newPort}"`,
      { encoding: "utf-8" }
    );

    // Only push if upstream tracking branch exists
    try {
      execSync(`git -C "${localPath}" push 2>&1`, {
        encoding: "utf-8",
        timeout: 10_000,
      });
      return { committed: true, pushed: true };
    } catch {
      return { committed: true, pushed: false };
    }
  } catch {
    return { committed: false, pushed: false };
  }
}
