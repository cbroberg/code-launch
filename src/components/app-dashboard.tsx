"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ScanLine, RefreshCw, Loader2,
  LayoutGrid, List, Search, X,
  Play, Square, RotateCcw,
  FolderOpen, ExternalLink, Pencil, Trash2,
  Terminal, Rocket, Plus, ArrowUpDown, Heart,
  Hammer, Package, Power,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { App } from "@/drizzle/schema";
import { EditAppDialog } from "./edit-app-dialog";
import { AppCard } from "./app-card";
import { LogViewer } from "./log-viewer";
import { AppSidebarShell } from "./app-sidebar-shell";
import { NewProjectDialog } from "./new-project-dialog";
import { VSCodeIcon, GitHubIcon } from "./brand-icons";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "running" | "stopped" | "error" | "favorites";
type SortBy = "alpha" | "port";

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js", hono: "Hono", express: "Express",
  vite: "Vite", remix: "Remix", sveltekit: "SvelteKit",
  astro: "Astro", fastify: "Fastify",
};

const TYPE_LABELS: Record<string, string> = {
  "web-app": "Web App", "api-server": "API Server",
  monorepo: "Monorepo", library: "Library",
  docker: "Docker", batch: "Batch",
};

interface Props { apps: App[] }

export function AppDashboard({ apps: initialApps }: Props) {
  const router = useRouter();
  const [apps, setApps] = useState<App[]>(initialApps);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [logApp, setLogApp] = useState<App | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("running");
  const [frameworkFilters, setFrameworkFilters] = useState<Set<string>>(new Set());
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>("alpha");
  const [scanning, setScanning] = useState(false);
  const [probing, setProbing] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [actionLoading, setActionLoading] = useState<Record<number, string>>({});
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);

  // Sync when server re-renders (after router.refresh())
  useEffect(() => { setApps(initialApps); }, [initialApps]);

  useEffect(() => {
    const saved = localStorage.getItem("cl-view");
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  // Status SSE — keeps badges + ports live without full page refresh
  useEffect(() => {
    const es = new EventSource("/api/status/stream");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; appId: number;
        status?: string; pid?: number | null; port?: number | null;
      };
      if (data.type === "snapshot" || data.type === "update") {
        setApps(prev => prev.map(a =>
          a.id === data.appId
            ? {
                ...a,
                status: data.status !== undefined ? data.status : a.status,
                pid: data.pid !== undefined ? data.pid : a.pid,
                port: data.port !== undefined ? data.port : a.port,
              }
            : a
        ));
        setLogApp(prev => prev?.id === data.appId
          ? { ...prev, status: data.status ?? prev.status, pid: data.pid !== undefined ? data.pid : prev.pid }
          : prev
        );
      } else if (data.type === "port" && data.port) {
        setApps(prev => prev.map(a =>
          a.id === data.appId ? { ...a, port: data.port as number } : a
        ));
      }
    };
    return () => es.close();
  }, []);

  // Check autostart status on mount
  useEffect(() => {
    fetch("/api/system/autostart")
      .then(r => r.json())
      .then(d => setAutostartEnabled(d.installed))
      .catch(() => {});
  }, []);

  async function handleToggleAutostart() {
    const next = !autostartEnabled;
    try {
      const res = await fetch("/api/system/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "install" : "uninstall" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setAutostartEnabled(next);
      toast.success(next ? "Auto-start enabled — Code Launcher starts with your Mac" : "Auto-start removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle auto-start");
    }
  }

  // Cmd+K focuses search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function setViewAndSave(v: "grid" | "list") {
    setView(v);
    localStorage.setItem("cl-view", v);
  }

  const frameworks = useMemo(() => {
    const f = new Set<string>();
    apps.forEach(a => { if (a.framework) f.add(a.framework); });
    return [...f].sort();
  }, [apps]);

  const types = useMemo(() => {
    const t = new Set<string>();
    apps.forEach(a => { if (a.projectType) t.add(a.projectType); });
    return [...t].sort();
  }, [apps]);

  const filtered = useMemo(() => {
    const result = apps.filter(app => {
      if (statusFilter === "favorites") {
        if (!app.favorite) return false;
      } else {
        if (statusFilter === "stopped" && app.status !== "stopped" && app.status !== null) return false;
        if (statusFilter === "running" && app.status !== "running") return false;
        if (statusFilter === "error" && app.status !== "error") return false;
      }
      if (frameworkFilters.size > 0 && (!app.framework || !frameworkFilters.has(app.framework))) return false;
      if (typeFilters.size > 0 && (!app.projectType || !typeFilters.has(app.projectType))) return false;
      const q = query.trim().toLowerCase();
      if (q && !app.name.toLowerCase().includes(q)) return false;
      return true;
    });

    if (sortBy === "alpha") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => {
        if (a.port === null && b.port === null) return a.name.localeCompare(b.name);
        if (a.port === null) return 1;
        if (b.port === null) return -1;
        return a.port - b.port;
      });
    }

    return result;
  }, [apps, statusFilter, frameworkFilters, typeFilters, query, sortBy]);

  const counts = useMemo(() => ({
    all: apps.length,
    running: apps.filter(a => a.status === "running").length,
    stopped: apps.filter(a => !a.status || a.status === "stopped").length,
    error: apps.filter(a => a.status === "error").length,
    favorites: apps.filter(a => a.favorite).length,
  }), [apps]);

  function toggleFramework(fw: string) {
    setFrameworkFilters(prev => { const n = new Set(prev); n.has(fw) ? n.delete(fw) : n.add(fw); return n; });
  }

  function toggleType(t: string) {
    setTypeFilters(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
    setFrameworkFilters(new Set());
    setTypeFilters(new Set());
  }

  const hasActiveFilters = !!query || statusFilter !== "all" || frameworkFilters.size > 0 || typeFilters.size > 0;

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      toast.success(`${data.inserted} added, ${data.updated} updated`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally { setScanning(false); }
  }

  async function handleProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/probe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Probe failed");
      if (data.updated > 0) toast.success(`${data.updated} status updated`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally { setProbing(false); }
  }

  async function handleProcessAction(app: App, action: "start" | "stop" | "restart") {
    if (!app.devCommand && action !== "stop") {
      toast.error("No dev command — run Scan first");
      return;
    }
    setActionLoading(p => ({ ...p, [app.id]: action }));
    try {
      const res = await fetch(`/api/apps/${app.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActionLoading(p => { const n = { ...p }; delete n[app.id]; return n; });
    }
  }

  async function handleToggleFavorite(app: App) {
    const next = !app.favorite;
    setApps(prev => prev.map(a => a.id === app.id ? { ...a, favorite: next } : a));
    try {
      const res = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      setApps(prev => prev.map(a => a.id === app.id ? { ...a, favorite: !next } : a));
    }
  }

  async function handleToggleAutoBoot(app: App) {
    const next = !app.autoBoot;
    // Optimistic UI update
    setApps(prev => prev.map(a => a.id === app.id ? { ...a, autoBoot: next } : a));
    try {
      const res = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoBoot: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success(next ? `Auto-boot enabled for "${app.name}"` : `Auto-boot disabled for "${app.name}"`);
    } catch (err) {
      // Revert on error
      setApps(prev => prev.map(a => a.id === app.id ? { ...a, autoBoot: !next } : a));
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleBuildAction(app: App, action: "install" | "build" | "run-build") {
    if (!app.localPath) { toast.error("No local path"); return; }
    setActionLoading(p => ({ ...p, [app.id]: action }));
    try {
      if (action === "install") {
        const res = await fetch(`/api/apps/${app.id}/install`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Install failed");
        toast.success(`Deps installed for "${app.name}" — check logs`);
        setLogApp(app);
      } else {
        const thenStart = action === "run-build";
        const res = await fetch(`/api/apps/${app.id}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thenStart }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Build failed");
        toast.success(thenStart ? `Building "${app.name}" — will auto-start when done` : `Building "${app.name}" — check logs`);
        setLogApp(app);
        if (thenStart) router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActionLoading(p => { const n = { ...p }; delete n[app.id]; return n; });
    }
  }

  async function handleDelete(app: App) {
    if (!confirm(`Delete "${app.name}"?`)) return;
    try {
      const res = await fetch(`/api/apps/${app.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success(`"${app.name}" deleted`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <AppSidebarShell>

        {/* Favorites */}
        <div>
          <button
            onClick={() => setStatusFilter("favorites")}
            className={cn(
              "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
              statusFilter === "favorites"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <span className="flex items-center gap-2">
              <Heart className={cn("h-3.5 w-3.5", statusFilter === "favorites" ? "fill-red-500 text-red-500" : "text-red-400")} />
              Favorites
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{counts.favorites}</span>
          </button>
        </div>

        {/* Status filter */}
        <div>
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
          {(["all", "running", "stopped", "error"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
                statusFilter === s
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn("h-1.5 w-1.5 rounded-full", {
                  "bg-zinc-500": s === "all" || s === "stopped",
                  "bg-green-500": s === "running",
                  "bg-red-500": s === "error",
                })} />
                <span className="capitalize">{s}</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{counts[s]}</span>
            </button>
          ))}
        </div>

        {/* Framework filter */}
        {frameworks.length > 0 && (
          <div>
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Framework</p>
            {frameworks.map(fw => (
              <button
                key={fw}
                onClick={() => toggleFramework(fw)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  frameworkFilters.has(fw)
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
              >
                <span className={cn("h-1 w-1 rounded-full shrink-0 transition-opacity", frameworkFilters.has(fw) ? "bg-primary opacity-100" : "opacity-0")} />
                {FRAMEWORK_LABELS[fw] ?? fw}
              </button>
            ))}
          </div>
        )}

        {/* Project type filter */}
        {types.length > 0 && (
          <div>
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Type</p>
            {types.map(t => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                  typeFilters.has(t)
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
              >
                <span className={cn("h-1 w-1 rounded-full shrink-0 transition-opacity", typeFilters.has(t) ? "bg-primary opacity-100" : "opacity-0")} />
                {TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>
        )}

      </AppSidebarShell>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Topbar */}
        <header className="flex items-center gap-3 px-6 h-14 border-b border-border shrink-0">
          <div className="flex-1 flex items-center gap-2">
            <div className="relative max-w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="h-8 pl-8 pr-14 text-sm bg-muted/40 border-border focus-visible:ring-1"
              />
              {query ? (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-px rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground/70">
                  <span>⌘</span><span>K</span>
                </kbd>
              )}
            </div>

            {/* Active filter chips */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground gap-1">
                <X className="h-3 w-3" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Right: count + view toggle + actions */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {filtered.length === initialApps.length
                ? `${initialApps.length} projects`
                : `${filtered.length} / ${initialApps.length}`}
              {counts.running > 0 && <span className="ml-1.5 text-green-500">· {counts.running} running</span>}
            </span>

            {/* Sort toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => setSortBy("alpha")}
                className={cn("px-2 py-1 rounded text-xs transition-colors flex items-center gap-1", sortBy === "alpha" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="Sort alphabetically"
              >
                A–Z
              </button>
              <button
                onClick={() => setSortBy("port")}
                className={cn("px-2 py-1 rounded text-xs transition-colors flex items-center gap-1", sortBy === "port" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="Sort by port number"
              >
                <ArrowUpDown className="h-3 w-3" />
                Port
              </button>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              <button
                onClick={() => setViewAndSave("list")}
                className={cn("p-1 rounded transition-colors", view === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewAndSave("grid")}
                className={cn("p-1 rounded transition-colors", view === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                title="Grid view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleProbe}
              disabled={probing || scanning}
              className="h-8 w-8 p-0 text-muted-foreground"
              title="Refresh status"
            >
              {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>

            <Button onClick={handleScan} disabled={scanning || probing} size="sm" className="h-8 gap-1.5">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
              {scanning ? "Scanning…" : "Scan"}
            </Button>

            {autostartEnabled !== null && (
              <Button
                variant={autostartEnabled ? "default" : "outline"}
                size="sm"
                onClick={handleToggleAutostart}
                className="h-8 gap-1.5"
                title={autostartEnabled ? "Auto-start enabled — click to disable" : "Enable auto-start at login"}
              >
                <Power className="h-3.5 w-3.5" />
                {autostartEnabled ? "Auto-start on" : "Auto-start off"}
              </Button>
            )}

            <Button onClick={() => setNewProjectOpen(true)} size="sm" className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm">{initialApps.length === 0 ? "No projects yet — click Scan to discover." : "No projects match the current filters."}</p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={clearFilters} className="mt-2 text-xs">Clear filters</Button>
              )}
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  actionLoading={actionLoading[app.id]}
                  onProcessAction={handleProcessAction}
                  onBuildAction={handleBuildAction}
                  onToggleAutoBoot={handleToggleAutoBoot}
                  onToggleFavorite={handleToggleFavorite}
                  onEdit={setEditingApp}
                  onDelete={handleDelete}
                  onShowLogs={setLogApp}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              {filtered.map((app, i) => (
                <ListRow
                  key={app.id}
                  app={app}
                  last={i === filtered.length - 1}
                  actionLoading={actionLoading[app.id]}
                  onProcessAction={handleProcessAction}
                  onBuildAction={handleBuildAction}
                  onToggleAutoBoot={handleToggleAutoBoot}
                  onToggleFavorite={handleToggleFavorite}
                  onEdit={setEditingApp}
                  onDelete={handleDelete}
                  onShowLogs={setLogApp}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {editingApp && (
        <EditAppDialog
          app={editingApp}
          open={true}
          onOpenChange={open => !open && setEditingApp(null)}
        />
      )}

      {logApp && (
        <LogViewer
          app={logApp}
          open={!!logApp}
          onOpenChange={open => !open && setLogApp(null)}
        />
      )}

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </div>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────

function ListRow({
  app, last, actionLoading, onProcessAction, onBuildAction, onToggleAutoBoot, onToggleFavorite, onEdit, onDelete, onShowLogs,
}: {
  app: App;
  last: boolean;
  actionLoading?: string;
  onProcessAction: (app: App, action: "start" | "stop" | "restart") => void;
  onBuildAction: (app: App, action: "install" | "build" | "run-build") => void;
  onToggleAutoBoot: (app: App) => void;
  onToggleFavorite: (app: App) => void;
  onEdit: (app: App) => void;
  onDelete: (app: App) => void;
  onShowLogs: (app: App) => void;
}) {
  const isRunning = app.status === "running";
  const isStarting = app.status === "starting";

  return (
    <div className={cn(
      "flex items-center gap-4 px-4 py-3 bg-card hover:bg-accent/30 transition-colors group",
      !last && "border-b border-border"
    )}>
      {/* Status dot */}
      <span className={cn("h-2 w-2 rounded-full shrink-0", {
        "bg-green-500": isRunning,
        "bg-yellow-400 animate-pulse": isStarting,
        "bg-red-500": app.status === "error",
        "bg-zinc-600": !app.status || app.status === "stopped",
      })} />

      {/* Name + command */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{app.name}</p>
        {app.devCommand && (
          <p className="text-[11px] text-muted-foreground font-mono truncate">{app.devCommand}</p>
        )}
      </div>

      {/* Badges */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        {app.framework && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0 border-border text-muted-foreground">
            {FRAMEWORK_LABELS[app.framework] ?? app.framework}
          </Badge>
        )}
        {app.projectType && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 py-0 border-border text-muted-foreground">
            {TYPE_LABELS[app.projectType] ?? app.projectType}
          </Badge>
        )}
      </div>

      {/* Port */}
      <div className="w-16 shrink-0">
        {app.port ? (
          <span className="text-xs font-mono text-muted-foreground">:{app.port}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Process control */}
        {app.devCommand && (
          <>
            {!isRunning && !isStarting ? (
              <ActionBtn onClick={() => onProcessAction(app, "start")} loading={actionLoading === "start"} title="Start" icon={<Play className="h-3.5 w-3.5" />} className="text-green-500 hover:text-green-400 hover:bg-green-500/10" />
            ) : (
              <>
                <ActionBtn onClick={() => onProcessAction(app, "stop")} loading={actionLoading === "stop"} title="Stop" icon={<Square className="h-3.5 w-3.5" />} className="text-red-500 hover:text-red-400 hover:bg-red-500/10" />
                <ActionBtn onClick={() => onProcessAction(app, "restart")} loading={actionLoading === "restart"} title="Restart" icon={<RotateCcw className="h-3.5 w-3.5" />} />
              </>
            )}
          </>
        )}

        {/* Build dropdown */}
        {app.localPath && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Build options"
              >
                <Hammer className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onBuildAction(app, "install")}>
                <Package className="h-3.5 w-3.5 mr-2" />
                Install deps
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBuildAction(app, "build")}>
                <Hammer className="h-3.5 w-3.5 mr-2" />
                Build
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onBuildAction(app, "run-build")}>
                <Play className="h-3.5 w-3.5 mr-2" />
                Build + Run
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* VS Code */}
        {app.localPath && (
          <a href={`vscode://file${app.localPath}`}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Open in VS Code">
            <VSCodeIcon className="h-3.5 w-3.5" />
          </a>
        )}

        {/* GitHub */}
        {app.githubUrl && (
          <a href={app.githubUrl} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="GitHub">
            <GitHubIcon className="h-3.5 w-3.5" />
          </a>
        )}

        <ActionBtn
          onClick={() => onToggleFavorite(app)}
          title={app.favorite ? "Remove from favorites" : "Add to favorites"}
          icon={<Heart className={cn("h-3.5 w-3.5", app.favorite ? "fill-red-500 text-red-500" : "")} />}
          className={app.favorite ? "text-red-500 hover:text-red-400 hover:bg-red-500/10" : undefined}
        />
        <ActionBtn
          onClick={() => onToggleAutoBoot(app)}
          title={app.autoBoot ? "Auto-boot on (click to disable)" : "Auto-boot off (click to enable)"}
          icon={<Rocket className="h-3.5 w-3.5" />}
          className={app.autoBoot ? "text-primary hover:text-primary/80 hover:bg-primary/10" : undefined}
        />
        <ActionBtn onClick={() => onShowLogs(app)} title="Logs" icon={<Terminal className="h-3.5 w-3.5" />} />
        <ActionBtn onClick={() => onEdit(app)} title="Edit" icon={<Pencil className="h-3.5 w-3.5" />} />
        <ActionBtn onClick={() => onDelete(app)} title="Delete" icon={<Trash2 className="h-3.5 w-3.5" />} className="hover:text-destructive hover:bg-destructive/10" />
      </div>
    </div>
  );
}

function ActionBtn({ onClick, loading, title, icon, className }: {
  onClick?: () => void;
  loading?: boolean;
  title: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className={cn("p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50", className)}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    </button>
  );
}
