import fs from "fs";
import path from "path";
import type { ScannedApp } from "./types";

const SCAN_ROOT = process.env.SCAN_ROOT || "/Users/cb/Apps";
const MAX_DEPTH = 6;

const SKIP_DIRS = new Set([
  "node_modules", ".pnp",
  ".next", ".nuxt", ".svelte-kit", ".expo", ".turbo",
  "dist", "build", "out", ".output", ".vercel",
  ".git",
  ".cache", ".parcel-cache", ".eslintcache",
  "coverage", "__snapshots__",
  "__pycache__", ".venv", "venv",
  "ios", "android", "DerivedData", "SourcePackages", "Pods", "fastlane",
  "vendor", "target", "bin", "obj",
  "tmp", "temp", "logs",
  ".yarn", ".pnpm-store",
]);

function portFromScript(script: string): number | null {
  const flagMatch = script.match(/(?:--port|-p)\s+(\d{4,5})\b/);
  if (flagMatch) return parseInt(flagMatch[1], 10);
  const prefixMatch = script.match(/\bPORT=(\d{4,5})\b/);
  if (prefixMatch) return parseInt(prefixMatch[1], 10);
  const djangoMatch = script.match(/runserver\s+(?:[\w.]+:)?(\d{4,5})\b/);
  if (djangoMatch) return parseInt(djangoMatch[1], 10);
  return null;
}

function detectViteConfig(dir: string): number | null {
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    const configPath = path.join(dir, name);
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const m = content.match(/server\s*:\s*\{[^}]*\bport\s*:\s*(\d{4,5})/);
      if (m) return parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  return null;
}

function detectPort(dir: string): number | null {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const scripts: Record<string, string> = pkg.scripts || {};
      const priority = ["dev", "develop", "start", "serve"];
      for (const key of priority) {
        if (scripts[key]) {
          const port = portFromScript(String(scripts[key]));
          if (port) return port;
        }
      }
      for (const val of Object.values(scripts)) {
        const port = portFromScript(String(val));
        if (port) return port;
      }
    } catch { /* ignore */ }
  }
  const vitePort = detectViteConfig(dir);
  if (vitePort) return vitePort;
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    const envPath = path.join(dir, envFile);
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const m = content.match(/^PORT=(\d{4,5})/m);
      if (m) return parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  for (const dcFile of ["docker-compose.yml", "docker-compose.yaml"]) {
    const dcPath = path.join(dir, dcFile);
    if (!fs.existsSync(dcPath)) continue;
    try {
      const content = fs.readFileSync(dcPath, "utf-8");
      const m = content.match(/['"\- ]+(\d{4,5}):\d{4,5}/);
      if (m) return parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  const flyTomlPath = path.join(dir, "fly.toml");
  if (fs.existsSync(flyTomlPath)) {
    try {
      const content = fs.readFileSync(flyTomlPath, "utf-8");
      const m = content.match(/internal_port\s*=\s*(\d{4,5})/);
      if (m) return parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  return null;
}

function detectGithub(dir: string): { githubName: string | null; githubUrl: string | null } {
  const gitConfigPath = path.join(dir, ".git", "config");
  if (!fs.existsSync(gitConfigPath)) return { githubName: null, githubUrl: null };
  try {
    const content = fs.readFileSync(gitConfigPath, "utf-8");
    const httpsMatch = content.match(/url\s*=\s*https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
    if (httpsMatch) {
      return { githubName: httpsMatch[1], githubUrl: `https://github.com/${httpsMatch[1]}` };
    }
    const sshMatch = content.match(/url\s*=\s*git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m);
    if (sshMatch) {
      return { githubName: sshMatch[1], githubUrl: `https://github.com/${sshMatch[1]}` };
    }
  } catch { /* ignore */ }
  return { githubName: null, githubUrl: null };
}

function detectPackageManager(dir: string): string | null {
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
    } catch { /* ignore */ }
  }
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

function detectFramework(dir: string): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch { return null; }
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

function detectRuntime(dir: string): string | null {
  if (fs.existsSync(path.join(dir, "bun.lock")) || fs.existsSync(path.join(dir, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(dir, "deno.json")) || fs.existsSync(path.join(dir, "deno.jsonc"))) return "deno";
  let current = path.dirname(dir);
  while (current !== SCAN_ROOT && current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "bun.lock")) || fs.existsSync(path.join(current, "bun.lockb"))) return "bun";
    current = path.dirname(current);
  }
  return "node";
}

function detectDevCommand(dir: string, pm: string | null): string | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts: Record<string, string> = pkg.scripts || {};
    if (!scripts["dev"] && !scripts["develop"] && !scripts["start"]) return null;
    const scriptKey = scripts["dev"] ? "dev" : scripts["develop"] ? "develop" : "start";
    const scriptVal = scripts[scriptKey] || "";
    if (scriptVal.includes("turbo")) {
      return pm === "pnpm" ? "pnpm dev" : pm === "bun" ? "bun dev" : "npm run dev";
    }
    if (!pm) return `npm run ${scriptKey}`;
    if (pm === "bun") return `bun run ${scriptKey}`;
    if (pm === "pnpm") return `pnpm ${scriptKey}`;
    if (pm === "yarn") return `yarn ${scriptKey}`;
    return `npm run ${scriptKey}`;
  } catch { return null; }
}

function classifyProject(dir: string, framework: string | null): string | null {
  if (
    fs.existsSync(path.join(dir, "turbo.json")) ||
    fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(dir, "pnpm-workspace.yml"))
  ) return "monorepo";
  const hasPkg = fs.existsSync(path.join(dir, "package.json"));
  if (!hasPkg) {
    if (fs.existsSync(path.join(dir, "docker-compose.yml")) || fs.existsSync(path.join(dir, "docker-compose.yaml"))) {
      return "docker";
    }
    return null;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    const scripts: Record<string, string> = pkg.scripts || {};
    if (!scripts["dev"] && !scripts["develop"] && !scripts["start"]) return "library";
  } catch { /* ignore */ }
  if (framework === "nextjs" || framework === "remix" || framework === "sveltekit" || framework === "astro") return "web-app";
  if (framework === "hono" || framework === "express" || framework === "fastify") return "api-server";
  if (framework === "vite") return "web-app";
  return "web-app";
}

function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "package.json")) ||
    fs.existsSync(path.join(dir, "docker-compose.yml")) ||
    fs.existsSync(path.join(dir, "docker-compose.yaml"))
  );
}

function findMonorepoRoot(dir: string): string | null {
  let current = path.dirname(dir);
  while (current !== SCAN_ROOT && current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "turbo.json")) ||
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "pnpm-workspace.yml"))
    ) return current;
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return current;
      } catch { /* ignore */ }
    }
    current = path.dirname(current);
  }
  return null;
}

function scanDir(dir: string, depth: number, results: ScannedApp[]): void {
  if (depth > MAX_DEPTH) return;
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
      results.push({ name, localPath: dir, port, githubName, githubUrl, packageManager, framework, runtime, devCommand, projectType });
    }
  }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    scanDir(path.join(dir, entry.name), depth + 1, results);
  }
}

export function scanApps(): ScannedApp[] {
  const rawResults: ScannedApp[] = [];
  scanDir(SCAN_ROOT, 0, rawResults);
  const byPath = new Map<string, ScannedApp>();
  for (const app of rawResults) byPath.set(app.localPath, app);
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

export function getScanRoot(): string {
  return SCAN_ROOT;
}

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
