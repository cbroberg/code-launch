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
// Directory traversal
// ---------------------------------------------------------------------------

function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "package.json")) ||
    fs.existsSync(path.join(dir, "docker-compose.yml")) ||
    fs.existsSync(path.join(dir, "docker-compose.yaml"))
  );
}

function scanDir(dir: string, depth: number, results: ScannedApp[]): void {
  if (depth > MAX_DEPTH) return;

  // Collect this directory if it looks like a project
  if (depth > 0 && isProjectRoot(dir)) {
    const port = detectPort(dir);
    const { githubName, githubUrl } = detectGithub(dir);

    if (port !== null || githubName !== null) {
      results.push({
        name: path.basename(dir),
        localPath: dir,
        port,
        githubName,
        githubUrl,
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
  const results: ScannedApp[] = [];
  scanDir(SCAN_ROOT, 0, results);
  return results;
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
          let updated = val
            .replace(/(?:--port|-p)\s+\d{4,5}\b/, (m) => m.replace(/\d{4,5}/, String(newPort)))
            .replace(/\bPORT=\d{4,5}\b/, `PORT=${newPort}`);
          if (updated !== val) {
            pkg.scripts[key] = updated;
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
