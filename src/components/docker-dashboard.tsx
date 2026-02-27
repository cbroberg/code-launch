"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, Play, Square, Container, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DockerContainer } from "@/app/api/docker/containers/route";

type GroupKey = "all" | "running" | "exited";

function statusColor(state: string) {
  if (state === "running") return "bg-green-500";
  if (state === "paused") return "bg-yellow-400";
  if (state === "restarting") return "bg-yellow-400 animate-pulse";
  return "bg-zinc-600";
}

function groupLabel(name: string): string {
  if (name.startsWith("k8s_POD")) return "k8s / pause";
  if (name.startsWith("k8s_")) {
    const parts = name.split("_");
    return `k8s / ${parts[1] ?? name}`;
  }
  return name;
}

export function DockerDashboard() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<GroupKey>("running");
  const [hideK8s, setHideK8s] = useState(true);
  const [hideMcp, setHideMcp] = useState(false);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch("/api/docker/containers");
      const data = await res.json();
      if (data.error && data.containers.length === 0) {
        setError(data.error);
      } else {
        setContainers(data.containers);
        setError(null);
      }
    } catch {
      setError("Failed to reach Docker API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 15_000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  async function handleAction(id: string, action: "start" | "stop") {
    setActionLoading(p => ({ ...p, [id]: action }));
    try {
      const res = await fetch(`/api/docker/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${action} failed`);
      await fetchContainers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActionLoading(p => { const n = { ...p }; delete n[id]; return n; });
    }
  }

  const filtered = containers.filter(c => {
    if (hideK8s && c.isKubernetes) return false;
    if (hideMcp && c.isMcp) return false;
    if (filter === "running" && c.state !== "running") return false;
    if (filter === "exited" && c.state === "running") return false;
    return true;
  });

  const counts = {
    all: containers.length,
    running: containers.filter(c => c.state === "running").length,
    exited: containers.filter(c => c.state !== "running").length,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-6 h-14 border-b border-border shrink-0">
        <div className="flex-1 flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Container className="h-4 w-4" />
            <span className="font-medium text-foreground">Docker</span>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1 ml-4">
            {(["all", "running", "exited"] as GroupKey[]).map(g => (
              <button
                key={g}
                onClick={() => setFilter(g)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs transition-colors capitalize",
                  filter === g
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                )}
              >
                {g} <span className="tabular-nums ml-1 opacity-60">{counts[g]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 ml-4">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideK8s}
                onChange={e => setHideK8s(e.target.checked)}
                className="rounded"
              />
              Hide k8s
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideMcp}
                onChange={e => setHideMcp(e.target.checked)}
                className="rounded"
              />
              Hide MCP
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} shown · {counts.running} running
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchContainers}
            disabled={loading}
            className="h-8 w-8 p-0 text-muted-foreground"
            title="Refresh"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Container className="h-10 w-10 opacity-30" />
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchContainers}>Retry</Button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Connecting to Docker…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Layers className="h-10 w-10 opacity-30 mb-3" />
            <p className="text-sm">No containers match the current filters.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {filtered.map((c, i) => (
              <ContainerRow
                key={c.id}
                container={c}
                last={i === filtered.length - 1}
                actionLoading={actionLoading[c.id]}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ContainerRow({
  container: c,
  last,
  actionLoading,
  onAction,
}: {
  container: DockerContainer;
  last: boolean;
  actionLoading?: string;
  onAction: (id: string, action: "start" | "stop") => void;
}) {
  const isRunning = c.state === "running";
  const isK8s = c.isKubernetes;

  return (
    <div className={cn(
      "flex items-center gap-4 px-4 py-3 bg-card hover:bg-accent/30 transition-colors",
      !last && "border-b border-border"
    )}>
      {/* Status dot */}
      <span className={cn("h-2 w-2 rounded-full shrink-0", statusColor(c.state))} />

      {/* Name + image */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{groupLabel(c.name)}</p>
        <p className="text-[11px] text-muted-foreground/70 font-mono truncate">{c.image}</p>
      </div>

      {/* Port bindings */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0">
        {c.ports.length > 0 ? (
          c.ports.map((p, i) => (
            <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">
              :{p.hostPort}→{p.containerPort}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-muted-foreground/40">no host ports</span>
        )}
      </div>

      {/* Running for / status */}
      <div className="w-28 shrink-0 text-right">
        <p className="text-xs text-muted-foreground tabular-nums truncate">{c.status}</p>
      </div>

      {/* Actions — no start/stop for k8s managed containers */}
      <div className="flex items-center gap-0.5 shrink-0">
        {!isK8s && (
          isRunning ? (
            <ContainerBtn
              onClick={() => onAction(c.id, "stop")}
              loading={actionLoading === "stop"}
              title="Stop"
              icon={<Square className="h-3.5 w-3.5" />}
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
            />
          ) : (
            <ContainerBtn
              onClick={() => onAction(c.id, "start")}
              loading={actionLoading === "start"}
              title="Start"
              icon={<Play className="h-3.5 w-3.5" />}
              className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
            />
          )
        )}
      </div>
    </div>
  );
}

function ContainerBtn({ onClick, loading, title, icon, className }: {
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
