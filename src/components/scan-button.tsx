"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScanLine, Loader2, RefreshCw } from "lucide-react";

export function ScanButton() {
  const [scanning, setScanning] = useState(false);
  const [probing, setProbing] = useState(false);
  const router = useRouter();

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      toast.success(
        `Scan complete: ${data.inserted} added, ${data.updated} updated (${data.discovered} discovered)`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/probe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Probe failed");
      toast.success(`Status refreshed: ${data.updated} updated`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleProbe}
        disabled={probing || scanning}
        variant="ghost"
        size="sm"
        title="Refresh running status"
      >
        {probing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </Button>
      <Button onClick={handleScan} disabled={scanning || probing} variant="outline">
        {scanning ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ScanLine className="h-4 w-4" />
        )}
        {scanning ? "Scanning..." : "Scan Apps"}
      </Button>
    </div>
  );
}
