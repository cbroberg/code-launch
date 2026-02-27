"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditAppDialog } from "./edit-app-dialog";
import { ProcessControls } from "./process-controls";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, ExternalLink, FolderOpen, Filter, Search, X } from "lucide-react";
import type { App } from "@/drizzle/schema";

interface AppsTableProps {
  apps: App[];
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "stopped") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-neutral-300" />
        Stopped
      </span>
    );
  }
  if (status === "starting") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-600">
        <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        Starting
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Error
      </span>
    );
  }
  return null;
}

function FrameworkBadge({ framework }: { framework: string | null }) {
  if (!framework) return null;

  const colors: Record<string, string> = {
    nextjs: "bg-black text-white border-black",
    hono: "bg-orange-100 text-orange-800 border-orange-200",
    express: "bg-neutral-100 text-neutral-700 border-neutral-200",
    vite: "bg-purple-100 text-purple-800 border-purple-200",
    remix: "bg-blue-100 text-blue-800 border-blue-200",
    sveltekit: "bg-red-100 text-red-800 border-red-200",
    astro: "bg-indigo-100 text-indigo-800 border-indigo-200",
    fastify: "bg-teal-100 text-teal-800 border-teal-200",
  };

  const labels: Record<string, string> = {
    nextjs: "Next.js",
    hono: "Hono",
    express: "Express",
    vite: "Vite",
    remix: "Remix",
    sveltekit: "SvelteKit",
    astro: "Astro",
    fastify: "Fastify",
  };

  const cls = colors[framework] || "bg-neutral-100 text-neutral-700 border-neutral-200";
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cls}`}>
      {labels[framework] || framework}
    </Badge>
  );
}

function RuntimeBadge({ runtime, pm }: { runtime: string | null; pm: string | null }) {
  const parts: string[] = [];
  if (runtime && runtime !== "node") parts.push(runtime);
  if (pm) parts.push(pm);
  if (parts.length === 0) return null;

  return (
    <span className="text-[10px] text-muted-foreground font-mono">
      {parts.join(" · ")}
    </span>
  );
}

function ProjectTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;

  const colors: Record<string, string> = {
    "web-app": "bg-blue-50 text-blue-700 border-blue-200",
    "api-server": "bg-green-50 text-green-700 border-green-200",
    monorepo: "bg-violet-50 text-violet-700 border-violet-200",
    library: "bg-amber-50 text-amber-700 border-amber-200",
    docker: "bg-sky-50 text-sky-700 border-sky-200",
    batch: "bg-neutral-50 text-neutral-600 border-neutral-200",
  };

  const labels: Record<string, string> = {
    "web-app": "Web App",
    "api-server": "API",
    monorepo: "Monorepo",
    library: "Library",
    docker: "Docker",
    batch: "Batch",
  };

  const cls = colors[type] || "bg-neutral-50 text-neutral-600 border-neutral-200";
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cls}`}>
      {labels[type] || type}
    </Badge>
  );
}

export function AppsTable({ apps }: AppsTableProps) {
  const router = useRouter();
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [hideWithoutPort, setHideWithoutPort] = useState(true);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = apps
    .filter((a) => !hideWithoutPort || a.port !== null)
    .filter((a) => !q || a.name.toLowerCase().includes(q));

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

  const withoutPort = apps.filter((a) => a.port === null).length;

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="h-7 pl-8 pr-7 text-xs"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          size="sm"
          variant={hideWithoutPort ? "default" : "outline"}
          onClick={() => setHideWithoutPort((v) => !v)}
          className="gap-1.5 h-7 text-xs shrink-0"
        >
          <Filter className="h-3 w-3" />
          {hideWithoutPort ? "With port only" : "Show all"}
        </Button>
        {withoutPort > 0 && !hideWithoutPort && (
          <span className="text-xs text-muted-foreground shrink-0">
            {withoutPort} without port
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {apps.length === 0
            ? <>No apps registered yet. Click <strong>Scan Apps</strong> to discover projects.</>
            : "No apps match the current filter."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Tech</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>GitHub</TableHead>
              <TableHead>Local Path</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((app) => (
              <TableRow key={app.id}>
                <TableCell className="w-28">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={app.status} />
                    <ProcessControls app={app} />
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex flex-col gap-0.5">
                    <span>{app.name}</span>
                    {app.devCommand && (
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]" title={app.devCommand}>
                        {app.devCommand}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <FrameworkBadge framework={app.framework} />
                      <ProjectTypeBadge type={app.projectType} />
                    </div>
                    <RuntimeBadge runtime={app.runtime} pm={app.packageManager} />
                  </div>
                </TableCell>
                <TableCell>
                  {app.port ? (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="font-mono">
                        :{app.port}
                      </Badge>
                      {app.status === "running" && app.port && (
                        <a
                          href={`http://localhost:${app.port}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title="Open in browser"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {app.githubUrl ? (
                    <a
                      href={app.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      {app.githubName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {app.localPath ? (
                    <a
                      href={`vscode://file${app.localPath}`}
                      className="text-xs text-muted-foreground font-mono flex items-center gap-1 hover:text-primary transition-colors"
                      title={`Open in VS Code: ${app.localPath}`}
                    >
                      <FolderOpen className="h-3 w-3 shrink-0" />
                      {app.localPath.replace("/Users/cb/Apps/", "~/Apps/")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditingApp(app)}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(app)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editingApp && (
        <EditAppDialog
          app={editingApp}
          open={true}
          onOpenChange={(open) => !open && setEditingApp(null)}
        />
      )}
    </>
  );
}
