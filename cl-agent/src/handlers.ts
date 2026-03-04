import { execSync, execFile } from "child_process";
import fs from "fs";
import type { AgentCommand, AgentEvent, DockerContainer } from "./types";
import {
  startProcess,
  stopProcess,
  restartProcess,
  installDeps,
  buildApp,
  reconcileProcesses,
} from "./process-manager";
import { scanApps, scanSingleDir } from "./scanner";
import { findVacantPort, getPidsOnPort } from "./port-utils";

type Send = (event: AgentEvent) => void;

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

interface PortBinding {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

function parsePortBindings(portsStr: string): PortBinding[] {
  const bindings: PortBinding[] = [];
  for (const part of portsStr.split(", ")) {
    const m = part.match(/(?:0\.0\.0\.0|::):(\d+)->(\d+)\/(tcp|udp)/);
    if (m) bindings.push({ hostPort: +m[1], containerPort: +m[2], protocol: m[3] });
  }
  return bindings;
}

function listDockerContainers(): DockerContainer[] {
  const raw = execSync('docker ps --all --format "{{json .}}"', {
    encoding: "utf-8",
    timeout: 8_000,
  });
  return raw.trim().split("\n").filter(Boolean).map(line => {
    const c = JSON.parse(line) as {
      ID: string; Names: string; Image: string;
      State: string; Status: string; Ports: string; RunningFor: string;
    };
    const name = c.Names.replace(/^\//, "");
    const imageName = c.Image.split(":")[0].split("/").pop() ?? c.Image;
    return {
      id: c.ID,
      shortId: c.ID.slice(0, 12),
      name,
      image: c.Image,
      imageName,
      state: c.State,
      status: c.Status,
      runningFor: c.RunningFor,
      ports: parsePortBindings(c.Ports ?? ""),
      isKubernetes: name.startsWith("k8s_"),
      isMcp: c.Image.includes("mcp") || name.includes("mcp"),
    };
  });
}

// ---------------------------------------------------------------------------
// HTTP probe
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

export async function handleCommand(cmd: AgentCommand, send: Send): Promise<void> {
  switch (cmd.type) {
    case "ping":
      send({ type: "pong" });
      return;

    case "start":
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      try {
        startProcess(cmd.app);
      } catch (err) {
        send({
          type: "log",
          appId: cmd.app.id,
          stream: "system",
          message: `Start error: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date().toISOString(),
        });
      }
      return;

    case "stop":
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      stopProcess(cmd.app).catch(console.error);
      return;

    case "restart":
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      restartProcess(cmd.app).catch(console.error);
      return;

    case "install":
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      installDeps(cmd.app, cmd.force ?? false).catch(console.error);
      return;

    case "build":
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      buildApp(cmd.app, cmd.thenStart ?? false).catch(console.error);
      return;

    case "scan": {
      try {
        const apps = scanApps();
        send({ type: "scanResult", requestId: cmd.requestId, apps });
      } catch (err) {
        send({
          type: "ack",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "probe": {
      const results = await Promise.all(
        cmd.apps.map(async (app) => {
          if (!app.port) {
            if (app.pid) {
              try { process.kill(app.pid, 0); return { appId: app.id, status: "running" as const, pid: app.pid }; }
              catch { return { appId: app.id, status: "stopped" as const, pid: null }; }
            }
            return null;
          }
          const up = await isHttpUp(app.port);
          if (up) {
            const pids = getPidsOnPort(app.port);
            return { appId: app.id, status: "running" as const, pid: pids[0] ?? null };
          }
          return { appId: app.id, status: "stopped" as const, pid: null };
        })
      );
      send({ type: "probeResult", requestId: cmd.requestId, results: results.filter((r): r is NonNullable<typeof r> => r !== null) });
      return;
    }

    case "reconcile": {
      const statuses = await reconcileProcesses(cmd.runningApps);
      send({ type: "reconcileResult", requestId: cmd.requestId, statuses });
      return;
    }

    case "readFile": {
      try {
        const content = fs.readFileSync(cmd.path, "utf-8");
        send({ type: "fileContent", requestId: cmd.requestId, content });
      } catch (err) {
        send({
          type: "ack",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "docker:list": {
      try {
        const containers = listDockerContainers();
        send({ type: "docker:containers", requestId: cmd.requestId, containers });
      } catch (err) {
        send({
          type: "ack",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "docker:start": {
      try {
        execSync(`docker start "${cmd.containerId}"`, { encoding: "utf-8", timeout: 15_000 });
        send({ type: "ack", requestId: cmd.requestId, ok: true });
      } catch (err) {
        send({
          type: "ack",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "docker:stop": {
      try {
        execSync(`docker stop "${cmd.containerId}"`, { encoding: "utf-8", timeout: 15_000 });
        send({ type: "ack", requestId: cmd.requestId, ok: true });
      } catch (err) {
        send({
          type: "ack",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "launchTerminal": {
      const escapedPath = cmd.path.replace(/"/g, '\\"');
      const script = [
        'try',
        '  tell application "iTerm"',
        '    create window with default profile',
        '    tell current session of current window',
        `      write text "cd \\"${escapedPath}\\" && claude"`,
        '    end tell',
        '  end tell',
        'on error',
        '  tell application "Terminal"',
        `    do script "cd \\"${escapedPath}\\" && claude"`,
        '    activate',
        '  end tell',
        'end try',
      ].join('\n');
      execFile('osascript', ['-e', script]);
      send({ type: "ack", requestId: cmd.requestId, ok: true });
      return;
    }

    case "vacantPort": {
      const extra = new Set<number>(cmd.usedPorts ?? []);
      const port = findVacantPort(extra);
      send({ type: "vacantPort", requestId: cmd.requestId, port });
      return;
    }

    case "importProject": {
      try {
        const alreadyExists = fs.existsSync(cmd.localPath);
        if (!alreadyExists) {
          execSync(`git clone "${cmd.githubUrl}.git" "${cmd.localPath}"`, { encoding: "utf-8", timeout: 120_000 });
        }
        const meta = scanSingleDir(cmd.localPath);
        const extra = new Set<number>(cmd.usedPorts ?? []);
        const port = findVacantPort(extra);
        send({
          type: "importProjectResult",
          requestId: cmd.requestId,
          ok: true,
          alreadyExists,
          port,
          packageManager: meta?.packageManager ?? null,
          framework: meta?.framework ?? null,
          runtime: meta?.runtime ?? null,
          devCommand: meta?.devCommand ?? null,
          projectType: meta?.projectType ?? null,
        });
      } catch (err) {
        send({
          type: "importProjectResult",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    case "createProject": {
      try {
        if (fs.existsSync(cmd.localPath)) {
          send({ type: "createProjectResult", requestId: cmd.requestId, ok: false, error: `Directory already exists: ${cmd.localPath}` });
          return;
        }
        const flags = cmd.flags.join(" ");
        execSync(`gh repo create "${cmd.githubRepo}" ${flags}`, { encoding: "utf-8", timeout: 30_000 });
        execSync(`git clone "https://github.com/${cmd.githubRepo}.git" "${cmd.localPath}"`, { encoding: "utf-8", timeout: 60_000 });
        const meta = scanSingleDir(cmd.localPath);
        const extra = new Set<number>(cmd.usedPorts ?? []);
        const port = findVacantPort(extra);
        send({
          type: "createProjectResult",
          requestId: cmd.requestId,
          ok: true,
          port,
          packageManager: meta?.packageManager ?? null,
          framework: meta?.framework ?? null,
          runtime: meta?.runtime ?? null,
          devCommand: meta?.devCommand ?? null,
          projectType: meta?.projectType ?? null,
          githubUrl: `https://github.com/${cmd.githubRepo}`,
        });
      } catch (err) {
        send({
          type: "createProjectResult",
          requestId: cmd.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
  }
}
