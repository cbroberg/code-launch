import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PLIST_LABEL = "com.cbroberg.code-launch";
const PLIST_PATH = path.join(process.env.HOME || "/Users/cb", "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
const APP_DIR = path.join(process.env.HOME || "/Users/cb", "Apps", "cbroberg", "code-launch");
const NODE_BIN = path.join(process.env.HOME || "/Users/cb", ".local", "share", "fnm", "aliases", "default", "bin");
const LOG_DIR = path.join(process.env.HOME || "/Users/cb", "Library", "Logs", "code-launch");

function getPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}/npm</string>
    <string>run</string>
    <string>dev</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_BIN}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${process.env.HOME || "/Users/cb"}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/stderr.log</string>
</dict>
</plist>
`;
}

export async function GET() {
  const installed = fs.existsSync(PLIST_PATH);
  return NextResponse.json({ installed, plistPath: PLIST_PATH });
}

export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({ action: "install" }));

  if (action === "install") {
    // Ensure log dir exists
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Write plist — macOS automatically picks up files in ~/Library/LaunchAgents/ at next login.
    // We do NOT call `launchctl load` here to avoid starting a second instance while CL is already running.
    fs.writeFileSync(PLIST_PATH, getPlist(), "utf-8");
    return NextResponse.json({ ok: true, action: "installed", plistPath: PLIST_PATH });
  }

  if (action === "uninstall") {
    if (fs.existsSync(PLIST_PATH)) {
      try {
        execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: "ignore" });
      } catch {
        // May not be loaded
      }
      fs.unlinkSync(PLIST_PATH);
    }
    return NextResponse.json({ ok: true, action: "uninstalled" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
