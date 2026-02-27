"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Play, Square, RotateCcw, Loader2 } from "lucide-react";
import type { App } from "@/drizzle/schema";

interface ProcessControlsProps {
  app: App;
}

export function ProcessControls({ app }: ProcessControlsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"start" | "stop" | "restart" | null>(null);

  const isRunning = app.status === "running";
  const isStarting = app.status === "starting";

  async function callAction(action: "start" | "stop" | "restart") {
    if (!app.devCommand) {
      toast.error("No dev command — kør scan for at detektere kommandoen");
      return;
    }
    setLoading(action);
    try {
      const res = await fetch(`/api/apps/${app.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      toast.success(
        action === "start" ? `${app.name} starting…` :
        action === "stop" ? `${app.name} stopped` :
        `${app.name} restarting…`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setLoading(null);
    }
  }

  if (!app.devCommand) {
    return <span className="text-xs text-muted-foreground">no cmd</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {!isRunning && !isStarting ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
          onClick={() => callAction("start")}
          disabled={loading !== null}
          title="Start"
        >
          {loading === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => callAction("stop")}
            disabled={loading !== null}
            title="Stop"
          >
            {loading === "stop" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => callAction("restart")}
            disabled={loading !== null}
            title="Restart"
          >
            {loading === "restart" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        </>
      )}
    </div>
  );
}
