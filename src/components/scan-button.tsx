"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScanLine, Loader2 } from "lucide-react";

export function ScanButton() {
  const [scanning, setScanning] = useState(false);
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

  return (
    <Button onClick={handleScan} disabled={scanning} variant="outline">
      {scanning ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <ScanLine className="h-4 w-4" />
      )}
      {scanning ? "Scanning..." : "Scan Apps"}
    </Button>
  );
}
