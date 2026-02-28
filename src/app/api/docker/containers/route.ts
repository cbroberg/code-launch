import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

export interface DockerContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageName: string;
  state: "running" | "exited" | "paused" | "restarting" | "created" | string;
  status: string;
  runningFor: string;
  ports: PortBinding[];
  isKubernetes: boolean;
  isMcp: boolean;
}

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

export async function GET() {
  const agent = getAgent();

  if (agent) {
    const event = await sendCommand({ type: "docker:list", requestId: crypto.randomUUID() }, 10_000);
    if (event.type === "docker:containers") return NextResponse.json({ containers: event.containers });
    return NextResponse.json({ containers: [], error: "Agent error" }, { status: 500 });
  }

  try {
    const raw = execSync('docker ps --all --format "{{json .}}"', {
      encoding: "utf-8",
      timeout: 8_000,
    });

    const containers: DockerContainer[] = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
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

    return NextResponse.json({ containers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unavailable = msg.includes("not found") || msg.includes("Cannot connect") || msg.includes("Is the docker daemon running");
    return NextResponse.json(
      { containers: [], error: unavailable ? "Docker not available" : msg },
      { status: unavailable ? 503 : 500 }
    );
  }
}
