// ---------------------------------------------------------------------------
// Shared types for the CL Web ↔ CL Agent WebSocket protocol
// ---------------------------------------------------------------------------

/** Minimal app metadata sent from CL Web to the agent for process operations. */
export interface AppConfig {
  id: number;
  name: string;
  localPath: string;
  devCommand: string | null;
  port: number | null;
  packageManager: string | null;
}

/** App entry used in probe / reconcile commands. */
export interface ProbeableApp {
  id: number;
  name: string;
  port: number | null;
  pid: number | null;
  localPath: string | null;
  devCommand: string | null;
  packageManager: string | null;
}

// ---------------------------------------------------------------------------
// Commands: CL Web → Agent
// ---------------------------------------------------------------------------

export type AgentCommand =
  | { type: "ping" }
  | { type: "start"; requestId: string; app: AppConfig }
  | { type: "stop"; requestId: string; app: AppConfig }
  | { type: "restart"; requestId: string; app: AppConfig }
  | { type: "install"; requestId: string; app: AppConfig; force?: boolean }
  | { type: "build"; requestId: string; app: AppConfig; thenStart?: boolean }
  | { type: "scan"; requestId: string }
  | { type: "probe"; requestId: string; apps: ProbeableApp[] }
  | { type: "reconcile"; requestId: string; runningApps: ProbeableApp[] }
  | { type: "readFile"; requestId: string; path: string }
  | { type: "docker:list"; requestId: string }
  | { type: "docker:start"; requestId: string; containerId: string }
  | { type: "docker:stop"; requestId: string; containerId: string }
  | { type: "launchTerminal"; requestId: string; path: string }
  | { type: "vacantPort"; requestId: string; usedPorts?: number[] }
  | { type: "createProject"; requestId: string; githubRepo: string; localPath: string; flags: string[]; usedPorts?: number[] }
  | { type: "importProject"; requestId: string; githubUrl: string; localPath: string; usedPorts?: number[] };

// ---------------------------------------------------------------------------
// Events: Agent → CL Web
// ---------------------------------------------------------------------------

export interface ScannedApp {
  name: string;
  localPath: string;
  port: number | null;
  githubName: string | null;
  githubUrl: string | null;
  packageManager: string | null;
  framework: string | null;
  runtime: string | null;
  devCommand: string | null;
  projectType: string | null;
}

export interface ProbeResult {
  appId: number;
  status: "running" | "stopped";
  pid: number | null;
}

export interface DockerContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageName: string;
  state: string;
  status: string;
  runningFor: string;
  ports: Array<{ hostPort: number; containerPort: number; protocol: string }>;
  isKubernetes: boolean;
  isMcp: boolean;
}

export type AgentEvent =
  | { type: "pong" }
  | { type: "hello"; agentId: string; name: string; scanRoot: string; version: string; platform: string }
  | { type: "log"; appId: number; stream: "stdout" | "stderr" | "system"; message: string; createdAt: string }
  | { type: "status"; appId: number; status: string; pid: number | null }
  | { type: "port"; appId: number; port: number }
  | { type: "ack"; requestId: string; ok: boolean; error?: string }
  | { type: "scanResult"; requestId: string; apps: ScannedApp[] }
  | { type: "probeResult"; requestId: string; results: ProbeResult[] }
  | { type: "reconcileResult"; requestId: string; statuses: ProbeResult[] }
  | { type: "fileContent"; requestId: string; content: string }
  | { type: "docker:containers"; requestId: string; containers: DockerContainer[] }
  | { type: "vacantPort"; requestId: string; port: number }
  | { type: "createProjectResult"; requestId: string; ok: boolean; error?: string; port?: number; packageManager?: string | null; framework?: string | null; runtime?: string | null; devCommand?: string | null; projectType?: string | null; githubUrl?: string }
  | { type: "importProjectResult"; requestId: string; ok: boolean; error?: string; alreadyExists?: boolean; port?: number; packageManager?: string | null; framework?: string | null; runtime?: string | null; devCommand?: string | null; projectType?: string | null };
