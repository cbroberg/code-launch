"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export function VacantPortBadge() {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vacant-port")
      .then((r) => r.json())
      .then((data) => setPort(data.port))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Finding port...
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-sm font-mono">
      Next available: :{port}
    </Badge>
  );
}
