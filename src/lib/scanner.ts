import fs from "fs";
import path from "path";

const SCAN_ROOT = "/Users/cb/Apps";
const MAX_DEPTH = 6;

// Directories that are never project roots and should not be traversed
const SKIP_DIRS = new Set([
  // Package managers / dependencies
  "node_modules",
  ".pnp",
  // Build outputs
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".expo",
  ".turbo",
  "dist",
  "build",
  "out",
  ".output",
  ".vercel",
  // VCS
  ".git",
  // Caches
  ".cache",
  ".parcel-cache",
  ".eslintcache",
  // Coverage / test artifacts
  "coverage",
  "__snapshots__",
  // Python
  "__pycache__",
  ".venv",
  "venv",
  // Mobile / native build artifacts
  "ios",
  "android",
  "DerivedData",
  "SourcePackages",
  "Pods",
  "fastlane",
  // Misc languages
  "vendor",        // PHP / Go
  "target",        // Rust / Java Maven
  "bin",
  "obj",           // .NET
  // Temp
  "tmp",
  "temp",
  "logs",
  // Monorepo tooling internal dirs (not source)
  ".yarn",
  ".pnpm-store",
]);

export interface ScannedApp {
  name: string;
  localPath: string;
  port: number | null;
  githubName: string | null;
  githubUrl: string | null;
  // New fields
  packageManager: string | null;
  framework: string | null;
  runtime: string | null;
  devCommand: string | null;
  projectType: string | null;
}

// ---------------------------------------------------------------------------
// Port detection
// ---------------------------------------------------------------------------

/**
 * Extracts a port number from a single script string.
 * Handles the most common dev-server flag styles across frameworks.
 */
function portFromScript(script: string): number | null {
  // --port NUMBER  (Next.js, webpack-dev-server, many CLIs)
  // -p NUMBER      (Next.js short form, Vite, serve, http-server, …)
  // Only match 4–5 digit ports to avoid false positives like SSH (-p 22)
  const flagMatch = script.match(/(?:--port|-p)\s+(\d{4,5})\b/);
  if (flagMatch) return parseInt(flagMatch[1], 10);

  // PORT=NUMBER <command>  (CRA, plain Node servers)
  const prefixMatch = script.match(/\bPORT=(\d{4,5})\b/);
  if (prefixMatch) return parseInt(prefixMatch[1], 10);

  // Django: manage.py runserver 0.0.0.0:8000 or runserver :8000
  const djangoMatch = script.match(/runserver\s+(?:[\w.]+:)?(\d{4,5})\b/);
  if (djangoMatch) return parseInt(djangoMatch[1], 10);

  return null;
}

/**
 * Checks vite.config.{ts,js,mts,mjs} for an explicit server.port value.
 */
function detectViteConfig(dir: string): number | null {
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    const configPath = path.join(dir, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      // Handles: server: { port: 5173 }  and  server:{port:5173}
      const m = content.match(/server\s*:\s*\{[^}]*\bport\s*:\s*(\d{4,5})/);
      if (m) return parseInt(m[1], 10);
    } catch {
      // ignore
    }
  }
  return null;
}

function detectPort(dir: string): number | null {
  // 1. package.json scripts — highest priority, most explicit
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const scripts: Record<string, string> = pkg.scripts || {};
      // Prefer "dev" script, then "start", then any other
      const priority = ["dev", "develop", "start", "serve"];
      for (const key of priority) {
        if (scripts[key]) {
          const port = portFromScript(String(scripts[key]));
          if (port) return port;
        }
      }
      // Fall back to any other script
      for (const val of Object.values(scripts)) {
        const port = portFromScript(String(val));
        if (port) return port;
      }
    } catch {
      // ignore parse errors
    }
  }

  // 2. Vite config file
  const vitePort = detectViteConfig(dir);
  if (vitePort) return vitePort;

  // 3. .env files — PORT=NUMBER
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    const envPath = path.join(dir, envFile);
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const m = content.match(/^PORT=(\d{4,5})/m);
      if (m) return parseInt(m[1], 10);
    } catch {
      // ignore
    }
  }

  // 4. docker-compose.yml — first host port mapping
  for (const dcFile of ["docker-compose.yml", "docker-compose.yaml"]) {
    const dcPath = path.join(dir, dcFile);
    if (!fs.existsSync(dcPath)) continue;
    try {
      const content = fs.readFileSync(dcPath, "utf-8");
      const m = content.match(/['"\- ]+(\d{4,5}):\d{4,5}/);
      if (m) return parseInt(m[1], 10);
    } catch {
      // ignore
    }
  }

  // 5. fly.toml — internal_port (used by Bun/Hono and other Fly.io apps)
  const flyTomlPath = path.join(dir, "fly.toml");
  if (fs.existsSync(flyTomlPath)) {
    try {
      const content = fs.readFileSync(flyTomlPath, "utf-8");
      const m = content.match(/internal_port\s*=\s*(\d{4,5})/);
      if (m) return parseInt(m[1], 10);
    } catch {
      // ignore
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// GitHub detection
// ---------------------------------------------------------------------------

function detectGithub(dir: string): { githubName: string | null; githubUrl: string | null } {
  const gitConfigPath = path.join(dir, ".git", "config");
  if (!fs.existsSync(gitConfigPath)) return { githubName: null, githubUrl: null };

  try {
    const content = fs.readFileSync(gitConfigPath, "utf-8");

    // HTTPS: https://github.com/owner/repo(.git)
    const httpsMatch = content.match(
      /url\s*=\s*https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m
    );
    if (httpsMatch) {
      const githubName = httpsMatch[1];
      return { githubName, githubUrl: `https://github.com/${githubName}` };
    }

    // SSH: git@github.com:owner/repo(.git)
    const sshMatch = content.match(
      /url\s*=\s*git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m
    );
    if (sshMatch) {
      const githubName = sshMatch[1];
      return { githubName, githubUrl: `https://github.com/${githubName}` };
    }
  } catch {
    // ignore
  }

  return { githubName: null, githubUrl: null };
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

function detectPackageManager(dir: string): string | null {
  // 1. Explicit packageManager field in package.json
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.packageManager) {
        const pm = String(pkg.packageManager);
        if (pm.startsWith("bun")) return "bun";
        if (pm.startsWith("pnpm")) return "pnpm";
        if (pm.startsWith("yarn")) return "yarn";
        if (pm.startsWith("npm")) return "npm";
      }
    } catch {
      // ignore
    }
  }

  // 2. Lock files — check current dir first, then walk up to monorepo root
  let current = dir;
  while (current !== SCAN_ROOT && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "bun.lock")) || fs.existsSync(path.join(current, "bun.lockb"))) return "bun";
    if (fs.existsSync(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(current, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(current, "package-lock.json"))) return "npm";
    current = path.dirname(current);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

function detectFramework(dir: string): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return null;
  }

  if (deps["next"]) return "nextjs";
  if (deps["hono"]) return "hono";
  if (deps["@remix-run/react"] || deps["@remix-run/node"]) return "remix";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps["astro"]) return "astro";
  if (deps["vite"]) return "vite";
  if (deps["express"]) return "express";
  if (deps["fastify"]) return "fastify";

  return null;
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

function detectRuntime(dir: string): string | null {
  // bun lockfile → bun runtime
  if (fs.existsSync(path.join(dir, "bun.lock")) || fs.existsSync(path.join(dir, "bun.lockb"))) {
    return "bun";
  }
  // deno.json → deno runtime
  if (fs.existsSync(path.join(dir, "deno.json")) || fs.existsSync(path.join(dir, "deno.jsonc"))) {
    return "deno";
  }
  // Check monorepo root for bun
  let current = path.dirname(dir);
  while (current !== SCAN_ROOT && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "bun.lock")) || fs.existsSync(path.join(current, "bun.lockb"))) {
      return "bun";
    }
    current = path.dirname(current);
  }
  return "node";
}

// ---------------------------------------------------------------------------
// Dev command detection
// ---------------------------------------------------------------------------

function detectDevCommand(dir: string, pm: string | null): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts: Record<string, string> = pkg.scripts || {};

    if (!scripts["dev"] && !scripts["develop"] && !scripts["start"]) return null;

    const scriptKey = scripts["dev"] ? "dev" : scripts["develop"] ? "develop" : "start";
    const scriptVal = scripts[scriptKey] || "";

    // Detect turbo dev
    if (scriptVal.includes("turbo")) {
      return pm === "pnpm" ? "pnpm dev" : pm === "bun" ? "bun dev" : "npm run dev";
    }

    // Construct pm-prefixed command
    if (!pm) return `npm run ${scriptKey}`;
    if (pm === "bun") return `bun run ${scriptKey}`;
    if (pm === "pnpm") return `pnpm ${scriptKey}`;
    if (pm === "yarn") return `yarn ${scriptKey}`;
    return `npm run ${scriptKey}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project type classification
// ---------------------------------------------------------------------------

function classifyProject(dir: string, framework: string | null): string | null {
  // Monorepo: has turbo.json or pnpm-workspace.yaml
  if (
    fs.existsSync(path.join(dir, "turbo.json")) ||
    fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(dir, "pnpm-workspace.yml"))
  ) {
    return "monorepo";
  }

  // Docker: has docker-compose.yml without package.json (or with)
  const hasPkg = fs.existsSync(path.join(dir, "package.json"));
  if (!hasPkg) {
    if (fs.existsSync(path.join(dir, "docker-compose.yml")) || fs.existsSync(path.join(dir, "docker-compose.yaml"))) {
      return "docker";
    }
    return null;
  }

  // Check scripts to determine library vs app
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    const scripts: Record<string, string> = pkg.scripts || {};
    const hasDev = !!(scripts["dev"] || scripts["develop"] || scripts["start"]);

    if (!hasDev) return "library";
  } catch {
    // ignore
  }

  if (framework === "nextjs" || framework === "remix" || framework === "sveltekit" || framework === "astro") {
    return "web-app";
  }
  if (framework === "hono" || framework === "express" || framework === "fastify") {
    return "api-server";
  }
  if (framework === "vite") return "web-app";

  return "web-app";
}

// ---------------------------------------------------------------------------
// Directory traversal
// ---------------------------------------------------------------------------

function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "package.json")) ||
    fs.existsSync(path.join(dir, "docker-compose.yml")) ||
    fs.existsSync(path.join(dir, "docker-compose.yaml"))
  );
}

/**
 * Walks up from `dir` (exclusive) to SCAN_ROOT (exclusive) looking for a
 * monorepo root — a directory that contains turbo.json, pnpm-workspace.yaml,
 * or a package.json with a `workspaces` field.
 * Returns the monorepo root path, or null if none found.
 */
function findMonorepoRoot(dir: string): string | null {
  let current = path.dirname(dir);
  while (current !== SCAN_ROOT && current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "turbo.json")) ||
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "pnpm-workspace.yml"))
    ) {
      return current;
    }
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return current;
      } catch {
        // ignore
      }
    }
    current = path.dirname(current);
  }
  return null;
}

function scanDir(dir: string, depth: number, results: ScannedApp[]): void {
  if (depth > MAX_DEPTH) return;

  // Collect this directory if it looks like a project
  if (depth > 0 && isProjectRoot(dir)) {
    const port = detectPort(dir);
    const { githubName, githubUrl } = detectGithub(dir);

    if (port !== null || githubName !== null) {
      const monorepoRoot = findMonorepoRoot(dir);
      const name = monorepoRoot
        ? `${path.basename(monorepoRoot)}/${path.basename(dir)}`
        : path.basename(dir);

      const packageManager = detectPackageManager(dir);
      const framework = detectFramework(dir);
      const runtime = detectRuntime(dir);
      const devCommand = detectDevCommand(dir, packageManager);
      const projectType = classifyProject(dir, framework);

      results.push({
        name,
        localPath: dir,
        port,
        githubName,
        githubUrl,
        packageManager,
        framework,
        runtime,
        devCommand,
        projectType,
      });
    }

    // Do NOT return — continue descending for monorepos with sub-packages
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    scanDir(path.join(dir, entry.name), depth + 1, results);
  }
}

export function scanApps(): ScannedApp[] {
  const rawResults: ScannedApp[] = [];
  scanDir(SCAN_ROOT, 0, rawResults);

  // Index by path for quick lookup
  const byPath = new Map<string, ScannedApp>();
  for (const app of rawResults) byPath.set(app.localPath, app);

  // Sub-packages: their monorepo root is also in the results.
  // Merge their port into the root and discard the sub-package — root always wins.
  const toRemove = new Set<string>();
  for (const app of rawResults) {
    const root = findMonorepoRoot(app.localPath);
    if (!root || !byPath.has(root)) continue;
    const rootApp = byPath.get(root)!;
    if (!rootApp.port && app.port) rootApp.port = app.port;
    toRemove.add(app.localPath);
  }

  return rawResults.filter(a => !toRemove.has(a.localPath));
}

/**
 * Scans a single directory and returns its metadata (without requiring it to
 * pass the normal port/github heuristics). Used when registering a brand-new project.
 */
export function scanSingleDir(dir: string): ScannedApp | null {
  if (!fs.existsSync(dir)) return null;
  const packageManager = detectPackageManager(dir);
  const framework = detectFramework(dir);
  const runtime = detectRuntime(dir);
  const devCommand = detectDevCommand(dir, packageManager);
  const projectType = classifyProject(dir, framework);
  const port = detectPort(dir);
  const { githubName, githubUrl } = detectGithub(dir);
  return {
    name: path.basename(dir),
    localPath: dir,
    port,
    githubName,
    githubUrl,
    packageManager,
    framework,
    runtime,
    devCommand,
    projectType,
  };
}

// ---------------------------------------------------------------------------
// Port write-back
// ---------------------------------------------------------------------------

/**
 * Writes a new port back to the underlying project files.
 * Mirrors the same priority order as detectPort().
 * Returns a list of relative file paths that were modified.
 */
export function writePortToApp(localPath: string, newPort: number): string[] {
  const updated: string[] = [];

  // 1. package.json scripts
  const pkgPath = path.join(localPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      let changed = false;
      if (pkg.scripts && typeof pkg.scripts === "object") {
        for (const [key, val] of Object.entries(pkg.scripts)) {
          if (typeof val !== "string") continue;
          const replaced = val
            .replace(/(?:--port|-p)\s+\d{4,5}\b/, (m) => m.replace(/\d{4,5}/, String(newPort)))
            .replace(/\bPORT=\d{4,5}\b/, `PORT=${newPort}`);
          if (replaced !== val) {
            pkg.scripts[key] = replaced;
            changed = true;
          }
        }
        // If dev script has no port flag at all, append -p {port}
        const devKey = ["dev", "develop", "start"].find(k => pkg.scripts[k]);
        if (!changed && devKey) {
          const devScript = String(pkg.scripts[devKey]);
          // Only add if it looks like a dev server command (next/vite/bun/node)
          if (/\b(next|vite|bun|node|tsx|ts-node)\b/.test(devScript)) {
            pkg.scripts[devKey] = devScript + ` -p ${newPort}`;
            changed = true;
          }
        }
      }
      if (changed) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        updated.push("package.json");
      }
    } catch {
      // ignore
    }
  }

  // 2. vite.config files
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    const configPath = path.join(localPath, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const replaced = content.replace(
        /(server\s*:\s*\{[^}]*\bport\s*:\s*)\d{4,5}/,
        `$1${newPort}`
      );
      if (replaced !== content) {
        fs.writeFileSync(configPath, replaced, "utf-8");
        updated.push(name);
      }
    } catch {
      // ignore
    }
  }

  // 3. .env files
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    const envPath = path.join(localPath, envFile);
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      if (/^PORT=\d+/m.test(content)) {
        fs.writeFileSync(envPath, content.replace(/^PORT=\d+/m, `PORT=${newPort}`), "utf-8");
        updated.push(envFile);
      }
    } catch {
      // ignore
    }
  }

  // 4. docker-compose.yml
  for (const dcFile of ["docker-compose.yml", "docker-compose.yaml"]) {
    const dcPath = path.join(localPath, dcFile);
    if (!fs.existsSync(dcPath)) continue;
    try {
      const content = fs.readFileSync(dcPath, "utf-8");
      const replaced = content.replace(/(['"\- ]+)\d{4,5}(:\d{4,5})/, `$1${newPort}$2`);
      if (replaced !== content) {
        fs.writeFileSync(dcPath, replaced, "utf-8");
        updated.push(dcFile);
      }
    } catch {
      // ignore
    }
  }

  return updated;
}
