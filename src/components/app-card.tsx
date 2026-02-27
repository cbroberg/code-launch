"use client";

import {
  Play, Square, RotateCcw, Loader2,
  ExternalLink, Pencil, Trash2, Terminal, Rocket, Heart,
  Hammer, Package, MoreHorizontal, Bot,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { VSCodeIcon, GitHubIcon } from "./brand-icons";
import type { App } from "@/drizzle/schema";
import { cn } from "@/lib/utils";

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js", hono: "Hono", express: "Express",
  vite: "Vite", remix: "Remix", sveltekit: "SvelteKit",
  astro: "Astro", fastify: "Fastify",
};

const TYPE_LABELS: Record<string, string> = {
  "web-app": "Web App", "api-server": "API",
  monorepo: "Monorepo", library: "Library",
  docker: "Docker", batch: "Batch",
};

interface Props {
  app: App;
  actionLoading?: string;
  onProcessAction: (app: App, action: "start" | "stop" | "restart") => void;
  onBuildAction: (app: App, action: "install" | "build" | "run-build") => void;
  onToggleAutoBoot: (app: App) => void;
  onToggleFavorite: (app: App) => void;
  onEdit: (app: App) => void;
  onDelete: (app: App) => void;
  onShowLogs: (app: App) => void;
}

export function AppCard({ app, actionLoading, onProcessAction, onBuildAction, onToggleAutoBoot, onToggleFavorite, onEdit, onDelete, onShowLogs }: Props) {
  const isRunning = app.status === "running";
  const isStarting = app.status === "starting";
  const isError = app.status === "error";

  return (
    <div className={cn(
      "group relative flex flex-col rounded-lg border bg-card transition-colors",
      isRunning ? "border-green-500/30 hover:border-green-500/50" :
      isError   ? "border-red-500/30 hover:border-red-500/50" :
                  "border-border hover:border-border/80 hover:bg-accent/10"
    )}>

      {/* Top */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("mt-0.5 h-2 w-2 rounded-full shrink-0", {
              "bg-green-500": isRunning,
              "bg-yellow-400 animate-pulse": isStarting,
              "bg-red-500": isError,
              "bg-zinc-600": !app.status || app.status === "stopped",
            })} />
            <p className="text-sm font-semibold truncate leading-tight">{app.name}</p>
          </div>
          {app.port && (
            <span className="text-xs font-mono text-muted-foreground shrink-0">:{app.port}</span>
          )}
        </div>

        {app.localPath && (
          <p className="text-[11px] text-muted-foreground/60 font-mono truncate pl-4">
            {app.localPath.replace("/Users/cb/Apps/", "~/Apps/")}
          </p>
        )}
      </div>

      {/* Badges */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {app.framework && (
          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
            {FRAMEWORK_LABELS[app.framework] ?? app.framework}
          </span>
        )}
        {app.projectType && (
          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
            {TYPE_LABELS[app.projectType] ?? app.projectType}
          </span>
        )}
        {app.packageManager && (
          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono">
            {app.packageManager}
          </span>
        )}
      </div>

      {/* Dev command */}
      {app.devCommand && (
        <div className="mx-4 mb-3 px-2.5 py-1.5 rounded bg-muted/40 border border-border/50">
          <p className="text-[11px] font-mono text-muted-foreground truncate">{app.devCommand}</p>
        </div>
      )}

      {/* Error message */}
      {isError && app.lastError && (
        <div className="mx-4 mb-3 px-2.5 py-1.5 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-[10px] text-red-400 truncate">{app.lastError}</p>
        </div>
      )}

      {/* Actions bar */}
      <div className="mt-auto flex items-center justify-between px-3 py-2.5 border-t border-border/50 bg-muted/20 rounded-b-lg">
        {/* Process controls */}
        <div className="flex items-center gap-0.5">
          {!app.devCommand && (isRunning || isStarting) ? (
            <CardAction
              onClick={() => onProcessAction(app, "stop")}
              loading={actionLoading === "stop"}
              title="Stop"
              icon={<Square className="h-3.5 w-3.5" />}
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
            />
          ) : !app.devCommand ? (
            <span className="text-[10px] text-muted-foreground/40 px-1">no cmd</span>
          ) : !isRunning && !isStarting ? (
            <CardAction
              onClick={() => onProcessAction(app, "start")}
              loading={actionLoading === "start"}
              title="Start"
              icon={<Play className="h-3.5 w-3.5" />}
              className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
            />
          ) : (
            <>
              <CardAction
                onClick={() => onProcessAction(app, "stop")}
                loading={actionLoading === "stop"}
                title="Stop"
                icon={<Square className="h-3.5 w-3.5" />}
                className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
              />
              <CardAction
                onClick={() => onProcessAction(app, "restart")}
                loading={actionLoading === "restart"}
                title="Restart"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
              />
            </>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-0.5">
          {app.port && (
            <a
              href={`http://localhost:${app.port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={`Open localhost:${app.port}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <CardAction onClick={() => onShowLogs(app)} title="Logs" icon={<Terminal className="h-3.5 w-3.5" />} />
          <CardAction
            onClick={() => onToggleFavorite(app)}
            title={app.favorite ? "Remove from favorites" : "Add to favorites"}
            icon={<Heart className={cn("h-3.5 w-3.5", app.favorite ? "fill-red-500 text-red-500" : "")} />}
            className={app.favorite ? "text-red-500 hover:text-red-400 hover:bg-red-500/10" : undefined}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="More options">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {app.localPath && (
                <DropdownMenuItem onClick={() => fetch(`/api/apps/${app.id}/launch-cc`, { method: "POST" })}>
                  <Bot className="h-3.5 w-3.5 mr-2 shrink-0" />
                  Launch Claude Code
                </DropdownMenuItem>
              )}
              {app.localPath && (
                <DropdownMenuItem asChild>
                  <a href={`vscode://file${app.localPath}`} className="flex items-center">
                    <VSCodeIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Open in VS Code
                  </a>
                </DropdownMenuItem>
              )}
              {app.githubUrl && (
                <DropdownMenuItem asChild>
                  <a href={app.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center">
                    <GitHubIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Open in GitHub
                  </a>
                </DropdownMenuItem>
              )}
              {(app.localPath || app.githubUrl) && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => onToggleAutoBoot(app)}>
                <Rocket className={cn("h-3.5 w-3.5 mr-2 shrink-0", app.autoBoot ? "text-primary" : "")} />
                {app.autoBoot ? "Auto-boot: on" : "Auto-boot: off"}
              </DropdownMenuItem>
              {app.localPath && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onBuildAction(app, "install")}>
                    <Package className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Install deps
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onBuildAction(app, "build")}>
                    <Hammer className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Build
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onBuildAction(app, "run-build")}>
                    <Play className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Build + Run
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEdit(app)}>
                <Pencil className="h-3.5 w-3.5 mr-2 shrink-0" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(app)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function CardAction({ onClick, loading, title, icon, className }: {
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
