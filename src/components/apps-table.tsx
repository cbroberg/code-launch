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
import { Pencil, Trash2, ExternalLink, FolderOpen, Filter } from "lucide-react";
import type { App } from "@/drizzle/schema";

interface AppsTableProps {
  apps: App[];
}

export function AppsTable({ apps }: AppsTableProps) {
  const router = useRouter();
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [hideWithoutPort, setHideWithoutPort] = useState(true);

  const visible = hideWithoutPort ? apps.filter((a) => a.port !== null) : apps;

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
        <Button
          size="sm"
          variant={hideWithoutPort ? "default" : "outline"}
          onClick={() => setHideWithoutPort((v) => !v)}
          className="gap-1.5 h-7 text-xs"
        >
          <Filter className="h-3 w-3" />
          {hideWithoutPort ? "Showing with port only" : "Show all"}
        </Button>
        {withoutPort > 0 && (
          <span className="text-xs text-muted-foreground">
            {withoutPort} without port
            {hideWithoutPort ? " hidden" : ""}
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
                    <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                      <FolderOpen className="h-3 w-3 shrink-0" />
                      {app.localPath.replace("/Users/cb/Apps/", "~/Apps/")}
                    </span>
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
