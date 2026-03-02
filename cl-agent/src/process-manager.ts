import { spawn, execSync, type ChildProcess, type SpawnOptions } from "child_process";
import path from "path";
import type { AppConfig, AgentEvent, ProbeResult, ProbeableApp } from "./types";
import { getPidsOnPort, getListeningPortForPid } from "./port-utils";

// Build a rich PATH for child processes: include node's own bin dir (fnm/nvm)
// so that pnpm, npm, bun etc. installed alongside node are always found.
const NODE_BIN_DIR = path.dirname(process.execPath);
const EXTRA_PATHS = [
  NODE_BIN_DIR,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
];
const CHILD_PATH = [...new Set([
  ...EXTRA_PATHS,
  ...(process.env.PATH || "").split(":").filter(Boolean),
])].join(":");

// ---------------------------------------------------------------------------
// Global singleton (process map persists across module reloads)
// ---------------------------------------------------------------------------

interface ManagedProcess {
  process: ChildProcess;
  appId: number;
  app: AppConfig;
  startedAt: string;
}

const processMap = new Map<number, ManagedProcess>();

// ---------------------------------------------------------------------------
// Event sender — updated when WS connects/reconnects
// ---------------------------------------------------------------------------

let sendEvent: ((event: AgentEvent) => void) | null = null;

export function setEventSender(fn: ((event: AgentEvent) => void) | null) {
  sendEvent = fn;
}

function emit(event: AgentEvent) {
  if (sendEvent) {
    try { sendEvent(event); } catch { /* WS might be closing */ }
  } else {
    console.log(`[agent] Event (no WS): ${event.type}`, "appId" in event ? event.appId : "");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appendLog(appId: number, stream: "stdout" | "stderr" | "system", message: string) {
  const createdAt = new Date().toISOString();
  emit({ type: "log", appId, stream, message, createdAt });
}

function setStatus(appId: number, status: string, pid: number | null = null) {
  emit({ type: "status", appId, status, pid });
}

function killPid(pid: number, signal: "SIGTERM" | "SIGKILL") {
  try { process.kill(-pid, signal); } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startProcess(app: AppConfig): void {
  if (processMap.has(app.id)) throw new Error("Already running");
  if (!app.devCommand) throw new Error("No dev command configured");
  if (!app.localPath) throw new Error("No local path configured");

  if (app.port && getPidsOnPort(app.port).length > 0) {
    // Port is already occupied — likely our own detached process survived an agent restart.
    // Adopt it instead of failing so the UI shows "running".
    const pids = getPidsOnPort(app.port);
    const existingPid = pids[0] ?? null;
    appendLog(app.id, "system", `Port ${app.port} already in use by PID ${existingPid} — adopting`);
    setStatus(app.id, "running", existingPid);
    return;
  }

  const now = new Date().toISOString();
  setStatus(app.id, "starting");
  appendLog(app.id, "system", `Starting: ${app.devCommand}`);

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: CHILD_PATH };
  if (app.port) env.PORT = String(app.port);

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
        appendLog(app.id, "stdout", line);
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(app.id, "stderr", line);
    });
  }

  child.on("spawn", () => {
    const pid = child.pid ?? null;
    setStatus(app.id, "running", pid);
    appendLog(app.id, "system", `Started with PID ${pid}`);

    if (pid && !app.port) {
      setTimeout(() => {
        const detected = getListeningPortForPid(pid);
        if (detected) {
          emit({ type: "port", appId: app.id, port: detected });
          appendLog(app.id, "system", `Detected port ${detected}`);
        }
      }, 3000);
    }
  });

  child.on("error", (err: Error) => {
    processMap.delete(app.id);
    setStatus(app.id, "error");
    appendLog(app.id, "system", `Error: ${err.message}`);
  });

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    processMap.delete(app.id);
    const msg = signal ? `Killed by signal ${signal}` : `Exited with code ${code}`;
    const newStatus = code === 0 || signal === "SIGTERM" ? "stopped" : "error";
    setStatus(app.id, newStatus);
    appendLog(app.id, "system", msg);
  });

  processMap.set(app.id, { process: child, appId: app.id, app, startedAt: now });
}

export async function stopProcess(app: AppConfig): Promise<void> {
  const managed = processMap.get(app.id);

  if (!managed) {
    const pids: number[] = [];
    if (app.port) pids.push(...getPidsOnPort(app.port));

    if (pids.length > 0) {
      appendLog(app.id, "system", `Stopping PID(s) ${pids.join(", ")}…`);
      for (const pid of pids) killPid(pid, "SIGTERM");

      await new Promise(r => setTimeout(r, 5000));
      if (app.port) {
        const stillUp = getPidsOnPort(app.port);
        if (stillUp.length > 0) {
          for (const pid of stillUp) killPid(pid, "SIGKILL");
          appendLog(app.id, "system", "Force killed (SIGKILL)");
        }
      }
    }

    setStatus(app.id, "stopped");
    return;
  }

  const child = managed.process;
  processMap.delete(app.id);
  appendLog(app.id, "system", "Stopping…");

  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      if (child.pid) killPid(child.pid, "SIGKILL");
      appendLog(app.id, "system", "Force killed (SIGKILL)");
      resolve();
    }, 5000);

    child.once("exit", () => { clearTimeout(timeout); resolve(); });

    if (child.pid) killPid(child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  });
}

export async function restartProcess(app: AppConfig): Promise<void> {
  await stopProcess(app);
  await new Promise(r => setTimeout(r, 500));
  startProcess(app);
}

async function runJob(appId: number, cmd: string, cwd: string): Promise<number> {
  appendLog(appId, "system", `Running: ${cmd}`);
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", cmd], {
      cwd,
      detached: false,
      env: { ...process.env, PATH: CHILD_PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout) {
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (data: string) => {
        for (const line of data.split("\n").filter(Boolean))
          appendLog(appId, "stdout", line);
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (data: string) => {
        for (const line of data.split("\n").filter(Boolean))
          appendLog(appId, "stderr", line);
      });
    }
    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      appendLog(appId, "system", `Exited with code ${exitCode}`);
      resolve(exitCode);
    });
    child.on("error", (err) => {
      appendLog(appId, "system", `Error: ${err.message}`);
      resolve(1);
    });
  });
}

export async function installDeps(app: AppConfig, force = false): Promise<void> {
  if (!app.localPath) throw new Error("No local path");
  const base = getInstallCommand(app.packageManager);
  const cmd = force ? `${base} --force` : base;
  const code = await runJob(app.id, cmd, app.localPath);
  if (code !== 0) throw new Error(`Install failed (exit ${code})`);
}

export async function buildApp(app: AppConfig, thenStart = false): Promise<void> {
  if (!app.localPath) throw new Error("No local path");

  if (processMap.has(app.id)) await stopProcess(app);

  const buildCmd = getBuildCommand(app.packageManager);
  const code = await runJob(app.id, buildCmd, app.localPath);
  if (code !== 0) {
    setStatus(app.id, "error");
    throw new Error(`Build failed (exit ${code})`);
  }

  if (!thenStart) return;

  const startCmd = getProdStartCommand(app.packageManager);
  appendLog(app.id, "system", `Build done — starting: ${startCmd}`);
  const env = { ...process.env };
  if (app.port) env.PORT = String(app.port);
  const now = new Date().toISOString();
  setStatus(app.id, "starting");

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
        appendLog(app.id, "stdout", line);
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data: string) => {
      for (const line of data.split("\n").filter(Boolean))
        appendLog(app.id, "stderr", line);
    });
  }
  child.on("spawn", () => {
    const pid = child.pid ?? null;
    setStatus(app.id, "running", pid);
    appendLog(app.id, "system", `Production server PID ${pid}`);
  });
  child.on("error", (err: Error) => {
    processMap.delete(app.id);
    setStatus(app.id, "error");
    appendLog(app.id, "system", `Error: ${err.message}`);
  });
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    processMap.delete(app.id);
    const newStatus = code === 0 || signal === "SIGTERM" ? "stopped" : "error";
    setStatus(app.id, newStatus);
  });
  processMap.set(app.id, { process: child, appId: app.id, app, startedAt: now });
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

/** Reconciles in-memory processMap against the list of apps the server thinks are running. */
export async function reconcileProcesses(runningApps: ProbeableApp[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  // Kill stale PIDs in processMap for apps NOT in the running list
  const runningIds = new Set(runningApps.map(a => a.id));
  for (const [appId, managed] of processMap) {
    if (!runningIds.has(appId)) {
      const pid = managed.process.pid;
      if (pid) {
        try { process.kill(pid, 0); process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
      }
      processMap.delete(appId);
    }
  }

  // Check each app
  for (const app of runningApps) {
    if (processMap.has(app.id)) {
      const managed = processMap.get(app.id)!;
      const pid = managed.process.pid;
      if (pid) {
        try {
          process.kill(pid, 0);
          results.push({ appId: app.id, status: "running", pid });
          continue;
        } catch { /* dead */ }
      }
      processMap.delete(app.id);
      results.push({ appId: app.id, status: "stopped", pid: null });
      continue;
    }

    // External process: HTTP check
    if (app.port) {
      const up = await isHttpUp(app.port);
      if (up) {
        const pids = getPidsOnPort(app.port);
        results.push({ appId: app.id, status: "running", pid: pids[0] ?? null });
      } else {
        results.push({ appId: app.id, status: "stopped", pid: null });
      }
    } else if (app.pid) {
      try {
        process.kill(app.pid, 0);
        results.push({ appId: app.id, status: "running", pid: app.pid });
      } catch {
        results.push({ appId: app.id, status: "stopped", pid: null });
      }
    } else {
      results.push({ appId: app.id, status: "stopped", pid: null });
    }
  }

  return results;
}

/** Returns current state of all managed processes (for hello/reconnect). */
export function getManagedApps(): Array<{ appId: number; pid: number | null }> {
  return Array.from(processMap.entries()).map(([appId, m]) => ({
    appId,
    pid: m.process.pid ?? null,
  }));
}
