"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 font-mono text-sm">
      <p className="text-red-500 font-bold text-base">{error.message}</p>
      {error.digest && (
        <p className="text-muted-foreground text-xs">Digest: {error.digest}</p>
      )}
      <pre className="max-w-2xl w-full bg-muted/40 border border-border rounded p-4 text-xs overflow-auto whitespace-pre-wrap text-red-400">
        {error.stack}
      </pre>
      <button
        onClick={reset}
        className="px-4 py-2 rounded border border-border hover:bg-accent text-sm"
      >
        Try again
      </button>
    </div>
  );
}
