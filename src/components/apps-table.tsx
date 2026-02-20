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
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, ExternalLink, FolderOpen, Filter, Search, X } from "lucide-react";
import type { App } from "@/drizzle/schema";

interface AppsTableProps {
  apps: App[];
}

export function AppsTable({ apps }: AppsTableProps) {
  const router = useRouter();
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [hideWithoutPort, setHideWithoutPort] = useState(true);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = apps
    .filter((a) => !hideWithoutPort || a.port !== null)
    .filter((a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.githubName ?? "").toLowerCase().includes(q) ||
      (a.localPath ?? "").toLowerCase().includes(q)
    );

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
            placeholder="Search by name, repo or path…"
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
              <TableHead>Name</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>GitHub</TableHead>
              <TableHead>Local Path</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((app) => (
              <TableRow key={app.id}>
                <TableCell className="font-medium">{app.name}</TableCell>
                <TableCell>
                  {app.port ? (
                    <Badge variant="outline" className="font-mono">
                      :{app.port}
                    </Badge>
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
