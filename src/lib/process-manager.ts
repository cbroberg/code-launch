import { spawn, execSync, type ChildProcess, type SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import { db } from "@/drizzle";
import { apps, processLogs } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Global singletons (survive HMR)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & {
  __processMap?: Map<number, ManagedProcess>;
  __logEmitter?: EventEmitter;
  __statusEmitter?: EventEmitter;
};

if (!g.__processMap) g.__processMap = new Map();
if (!g.__logEmitter) { g.__logEmitter = new EventEmitter(); g.__logEmitter.setMaxListeners(200); }
if (!g.__statusEmitter) { g.__statusEmitter = new EventEmitter(); g.__statusEmitter.setMaxListeners(200); }

interface ManagedProcess {
  process: ChildProcess;
  appId: number;
  startedAt: string;
}

export const processMap: Map<number, ManagedProcess> = g.__processMap;

/** Emits `log:<appId>` with { stream, message, createdAt } */
export const logEmitter: EventEmitter = g.__logEmitter;

/** Emits `status` with { appId, status, pid? } */
export const statusEmitter: EventEmitter = g.__statusEmitter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function appendLog(appId: number, stream: "stdout" | "stderr" | "system", message: string) {
  const createdAt = new Date().toISOString();
  await db.insert(processLogs).values({ appId, stream, message, createdAt });
  logEmitter.emit(`log:${appId}`, { stream, message, createdAt });

  // Prune: keep newest 1000
  const count = await db.$count(processLogs, eq(processLogs.appId, appId));
  if (count > 1000) {
    const oldest = await db
      .select({ id: processLogs.id })
      .from(processLogs)
      .where(eq(processLogs.appId, appId))
      .orderBy(processLogs.id)
      .limit(100);
    for (const row of oldest) {
      await db.delete(processLogs).where(eq(processLogs.id, row.id));
    }
  }
}

async function setStatus(
  appId: number,
  status: string,
  extra: Partial<{ pid: number | null; lastError: string | null; lastStartedAt: string; port: number }> = {}
) {
  const now = new Date().toISOString();
  const { port: _port, ...dbExtra } = extra;
  await db
    .update(apps)
    .set({ status, updatedAt: now, ...dbExtra })
    .where(eq(apps.id, appId));
  statusEmitter.emit("status", { appId, status, pid: extra.pid ?? null });
}

async function updatePort(appId: number, port: number) {
  await db
    .update(apps)
    .set({ port, updatedAt: new Date().toISOString() })
    .where(eq(apps.id, appId));
  statusEmitter.emit("port", { appId, port });
}

function getPidsOnPort(port: number): number[] {
  try {
    const out = execSync(`lsof -ti TCP:${port} -s TCP:LISTEN 2>/dev/null`, { encoding: "utf-8" });
    return out.trim().split("\n").filter(Boolean).map(Number).filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

/** Returns the first TCP LISTEN port for a given PID (including direct child processes). */
function getListeningPortForPid(pid: number): number | null {
  try {
    // Also include direct children (npm/bun spawn a child that binds the port)
    let pidList = String(pid);
    try {
      const children = execSync(`pgrep -P ${pid} 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (children) pidList += "," + children.split("\n").filter(Boolean).join(",");
    } catch { /* no children or pgrep unavailable */ }

    const out = execSync(`lsof -p ${pidList} -i TCP -P -n 2>/dev/null`, { encoding: "utf-8" });
    for (const line of out.split("\n")) {
      if (!line.includes("LISTEN")) continue;
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  } catch {
    return null;
  }
}

function killPid(pid: number, signal: "SIGTERM" | "SIGKILL") {
  try { process.kill(-pid, signal); } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startProcess(appId: number): Promise<void> {
  if (processMap.has(appId)) throw new Error("Already running");

  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error("App not found");
  if (!app.devCommand) throw new Error("No dev command configured");
  if (!app.localPath) throw new Error("No local path configured");

  // Guard: refuse to start if the port is already listening
  if (app.port && getPidsOnPort(app.port).length > 0) {
    throw new Error(`Port ${app.port} is already in use — stop the existing process first`);
  }

  const now = new Date().toISOString();
  await setStatus(appId, "starting", { pid: null, lastStartedAt: now, lastError: null });
  await appendLog(appId, "system", `Starting: ${app.devCommand}`);

  const env = { ...process.env };
  if (app.port) env.PORT = String(app.port);

  // Use bash with the inherited environment (no profile loading).
  // Code Launcher inherits the correct PATH from the terminal it was started in.
  // Loading shell profiles (~/.bashrc, ~/.zshrc) can override the Node version.
  const spawnOpts: SpawnOptions = {
    cwd: app.localPath,
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  };

  const child: ChildProcess = spawn("/bin/bash", ["-c", app.devCommand], spawnOpts);

  if (child.stdout) {
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(appId, "stdout", line).catch(() => {});
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(appId, "stderr", line).catch(() => {});
    });
  }

  child.on("spawn", async () => {
    const pid = child.pid ?? null;
    await setStatus(appId, "running", { pid });
    await appendLog(appId, "system", `Started with PID ${pid}`);

    // Auto-detect port if not already set
    if (pid && !app.port) {
      setTimeout(async () => {
        const detected = getListeningPortForPid(pid);
        if (detected) {
          await updatePort(appId, detected);
          await appendLog(appId, "system", `Detected port ${detected}`);
        }
      }, 3000);
    }
  });

  child.on("error", async (err: Error) => {
    processMap.delete(appId);
    await setStatus(appId, "error", { pid: null, lastError: err.message });
    await appendLog(appId, "system", `Error: ${err.message}`);
  });

  child.on("exit", async (code: number | null, signal: NodeJS.Signals | null) => {
    processMap.delete(appId);
    const msg = signal ? `Killed by signal ${signal}` : `Exited with code ${code}`;
    const newStatus = code === 0 || signal === "SIGTERM" ? "stopped" : "error";
    await setStatus(appId, newStatus, {
      pid: null,
      lastError: newStatus === "error" ? msg : null,
    });
    await appendLog(appId, "system", msg);
  });

  processMap.set(appId, { process: child, appId, startedAt: now });
}

export async function stopProcess(appId: number): Promise<void> {
  const managed = processMap.get(appId);

  if (!managed) {
    const [app] = await db.select().from(apps).where(eq(apps.id, appId));
    const now = new Date().toISOString();

    const pids: number[] = [];
    if (app?.pid) {
      pids.push(app.pid);
    } else if (app?.port) {
      pids.push(...getPidsOnPort(app.port));
    }

    if (pids.length > 0) {
      await appendLog(appId, "system", `Stopping PID(s) ${pids.join(", ")}…`).catch(() => {});
      for (const pid of pids) killPid(pid, "SIGTERM");

      await new Promise(r => setTimeout(r, 5000));
      if (app?.port) {
        const stillUp = getPidsOnPort(app.port);
        if (stillUp.length > 0) {
          for (const pid of stillUp) killPid(pid, "SIGKILL");
          await appendLog(appId, "system", "Force killed (SIGKILL)").catch(() => {});
        }
      }
    }

    await setStatus(appId, "stopped", { pid: null });
    return;
  }

  const child = managed.process;
  processMap.delete(appId);
  await appendLog(appId, "system", "Stopping…");

  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      if (child.pid) killPid(child.pid, "SIGKILL");
      await appendLog(appId, "system", "Force killed (SIGKILL)");
      resolve();
    }, 5000);

    child.once("exit", () => { clearTimeout(timeout); resolve(); });

    if (child.pid) killPid(child.pid, "SIGTERM");
    else { child.kill("SIGTERM"); }
  });
}

export async function restartProcess(appId: number): Promise<void> {
  await stopProcess(appId);
  await new Promise(r => setTimeout(r, 500));
  await startProcess(appId);
}

export async function clearLogs(appId: number): Promise<void> {
  await db.delete(processLogs).where(eq(processLogs.appId, appId));
}

// ---------------------------------------------------------------------------
// Install & Build jobs
// ---------------------------------------------------------------------------

function getInstallCommand(pm: string | null): string {
  if (pm === "pnpm") return "pnpm install";
  if (pm === "bun") return "bun install";
  if (pm === "yarn") return "yarn";
  return "npm install";
}

function getBuildCommand(pm: string | null): string {
  if (pm === "pnpm") return "pnpm build";
  if (pm === "bun") return "bun run build";
  if (pm === "yarn") return "yarn build";
  return "npm run build";
}

function getProdStartCommand(pm: string | null): string {
  if (pm === "pnpm") return "pnpm start";
  if (pm === "bun") return "bun start";
  if (pm === "yarn") return "yarn start";
  return "npm start";
}

async function runJob(appId: number, cmd: string, cwd: string): Promise<number> {
  await appendLog(appId, "system", `Running: ${cmd}`);
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", cmd], {
      cwd,
      detached: false,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout) {
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (data: string) => {
        for (const line of data.split("\n").filter(Boolean))
          appendLog(appId, "stdout", line).catch(() => {});
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (data: string) => {
        for (const line of data.split("\n").filter(Boolean))
          appendLog(appId, "stderr", line).catch(() => {});
      });
    }
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      appendLog(appId, "system", `Exited with code ${exitCode}`).catch(() => {});
      resolve(exitCode);
    });
    child.on("error", (err) => {
      appendLog(appId, "system", `Error: ${err.message}`).catch(() => {});
      resolve(1);
    });
  });
}

export async function installDeps(appId: number): Promise<void> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error("App not found");
  if (!app.localPath) throw new Error("No local path");
  const cmd = getInstallCommand(app.packageManager);
  const code = await runJob(appId, cmd, app.localPath);
  if (code !== 0) throw new Error(`Install failed (exit ${code})`);
}

export async function buildApp(appId: number, thenStart = false): Promise<void> {
  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app) throw new Error("App not found");
  if (!app.localPath) throw new Error("No local path");

  if (processMap.has(appId)) await stopProcess(appId);

  const buildCmd = getBuildCommand(app.packageManager);
  const code = await runJob(appId, buildCmd, app.localPath);
  if (code !== 0) {
    await setStatus(appId, "error", { lastError: `Build failed (exit ${code})` });
    throw new Error(`Build failed (exit ${code})`);
  }

  if (!thenStart) return;

  const startCmd = getProdStartCommand(app.packageManager);
  await appendLog(appId, "system", `Build done — starting production server: ${startCmd}`);
  const env = { ...process.env };
  if (app.port) env.PORT = String(app.port);
  const now = new Date().toISOString();
  await setStatus(appId, "starting", { pid: null, lastStartedAt: now, lastError: null });

  const child = spawn("/bin/bash", ["-c", startCmd], {
    cwd: app.localPath,
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.stdout) {
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(appId, "stdout", line).catch(() => {});
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(appId, "stderr", line).catch(() => {});
    });
  }
  child.on("spawn", async () => {
    const pid = child.pid ?? null;
    await setStatus(appId, "running", { pid });
    await appendLog(appId, "system", `Production server PID ${pid}`);
  });
  child.on("error", async (err: Error) => {
    processMap.delete(appId);
    await setStatus(appId, "error", { pid: null, lastError: err.message });
  });
  child.on("exit", async (code: number | null, signal: NodeJS.Signals | null) => {
    processMap.delete(appId);
    const newStatus = code === 0 || signal === "SIGTERM" ? "stopped" : "error";
    await setStatus(appId, newStatus, {
      pid: null,
      lastError: newStatus === "error" ? `Exited (code ${code})` : null,
    });
  });
  processMap.set(appId, { process: child, appId, startedAt: now });
}

async function isHttpUp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2500),
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

export async function reconcileProcesses(): Promise<void> {
  const runningApps = await db.select().from(apps).where(eq(apps.status, "running"));

  await Promise.all(runningApps.map(async (app) => {
    // Apps managed by our process manager: check PID liveness
    if (processMap.has(app.id)) {
      const managed = processMap.get(app.id)!;
      const pid = managed.process.pid;
      if (pid) {
        try { process.kill(pid, 0); return; } catch { /* dead */ }
      }
      processMap.delete(app.id);
      await setStatus(app.id, "stopped", { pid: null });
      return;
    }

    // External apps: HTTP is the only reliable check
    if (app.port) {
      const up = await isHttpUp(app.port);
      if (!up) {
        await setStatus(app.id, "stopped", { pid: null });
      } else if (!app.pid) {
        // Update PID if we didn't have it
        const pids = getPidsOnPort(app.port);
        if (pids.length > 0) {
          await db.update(apps).set({ pid: pids[0], updatedAt: new Date().toISOString() }).where(eq(apps.id, app.id));
        }
      }
      return;
    }

    // No port and not managed: check PID if available
    if (app.pid) {
      try { process.kill(app.pid, 0); } catch {
        await setStatus(app.id, "stopped", { pid: null });
      }
    }
  }));

  // Detect ports for managed running apps with PID but no port
  const noportApps = await db.select().from(apps).where(
    eq(apps.status, "running")
  );
  for (const app of noportApps) {
    if (app.port) continue;
    const pid = app.pid ?? (processMap.get(app.id)?.process.pid ?? null);
    if (!pid) continue;
    const detected = getListeningPortForPid(pid);
    if (detected) await updatePort(app.id, detected);
  }
}
