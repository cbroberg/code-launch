"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { App } from "@/drizzle/schema";

interface EditAppDialogProps {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAppDialog({ app, open, onOpenChange }: EditAppDialogProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: app.name,
    port: app.port?.toString() ?? "",
    githubName: app.githubName ?? "",
    githubUrl: app.githubUrl ?? "",
    localPath: app.localPath ?? "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        githubName: form.githubName || null,
        githubUrl: form.githubUrl || null,
        localPath: form.localPath || null,
      };

      if (form.port === "") {
        body.port = null;
      } else {
        const portNum = parseInt(form.port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          toast.error("Invalid port number");
          return;
        }
        body.port = portNum;
      }

      const res = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");

      const written: string[] = data.writtenFiles ?? [];
      if (written.length > 0) {
        toast.success(`App updated — also wrote ${written.join(", ")} on disk`);
      } else {
        toast.success("App updated");
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit App</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" value={form.name} onChange={handleChange} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              name="port"
              type="number"
              placeholder="e.g. 3000"
              value={form.port}
              onChange={handleChange}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="githubName">GitHub (owner/repo)</Label>
            <Input
              id="githubName"
              name="githubName"
              placeholder="cbroberg/my-app"
              value={form.githubName}
              onChange={handleChange}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="localPath">Local Path</Label>
            <Input
              id="localPath"
              name="localPath"
              placeholder="/Users/cb/Apps/..."
              value={form.localPath}
              onChange={handleChange}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
