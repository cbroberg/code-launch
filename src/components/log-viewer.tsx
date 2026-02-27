"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Trash2, ArrowDown, CircleDot, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { App } from "@/drizzle/schema";

interface LogLine {
  stream: "stdout" | "stderr" | "system";
  message: string;
  createdAt: string;
  historical?: boolean;
}

interface Props {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogViewer({ app, open, onOpenChange }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    setLines([]);
    setConnected(false);

    const es = new EventSource(`/api/apps/${app.id}/logs/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "ready") return;
      if (data.type) return; // other control messages
      setLines(prev => [...prev.slice(-1999), data as LogLine]);
    };

    es.onerror = () => {
      setConnected(false);
    };
  }, [app.id]);

  // Connect when sheet opens, disconnect when it closes
  useEffect(() => {
    if (open) {
      connect();
    } else {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    }
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [open, connect]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  }

  async function handleClear() {
    try {
      const res = await fetch(`/api/apps/${app.id}/logs`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setLines([]);
      toast.success("Logs cleared");
    } catch {
      toast.error("Failed to clear logs");
    }
  }

  const isRunning = app.status === "running";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[620px] sm:max-w-[620px] flex flex-col p-0 gap-0 border-l border-border bg-[#0d0d10]"
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between px-4 py-3 border-b border-border/50 space-y-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn(
              "h-2 w-2 rounded-full shrink-0",
              connected ? "bg-green-500" : "bg-zinc-600"
            )} />
            <SheetTitle className="text-sm font-mono font-medium text-foreground truncate">
              {app.name}
            </SheetTitle>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border font-mono",
              isRunning
                ? "border-green-500/40 text-green-400 bg-green-500/10"
                : "border-border text-muted-foreground"
            )}>
              {app.status ?? "stopped"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              className={cn("h-7 w-7 p-0 text-muted-foreground", autoScroll && "text-primary")}
              title="Scroll to bottom"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              title="Clear logs"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        {/* Terminal */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-5"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#27272a transparent" }}
        >
          {lines.length === 0 ? (
            <div className="flex items-center gap-2 text-zinc-600 mt-4">
              <CircleDot className="h-3.5 w-3.5" />
              <span>
                {connected
                  ? "Waiting for output…"
                  : "No logs captured — process may have been started externally"}
              </span>
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="flex gap-2 group">
                <span className="text-zinc-700 shrink-0 select-none w-4 text-right">{/* spacer */}</span>
                <span className={cn(
                  "break-all whitespace-pre-wrap",
                  line.stream === "stderr" && "text-red-400",
                  line.stream === "system" && "text-blue-400/80 italic",
                  line.stream === "stdout" && "text-zinc-300",
                )}>
                  {line.message}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600 font-mono">
            {lines.length > 0 ? `${lines.length} lines` : ""}
            {app.devCommand && <span className="ml-2">{app.devCommand}</span>}
          </span>
          <span className={cn(
            "text-[10px] font-mono",
            connected ? "text-green-600" : "text-zinc-700"
          )}>
            {connected ? "● live" : "○ disconnected"}
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
