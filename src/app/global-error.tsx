"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "monospace", background: "#0a0a0a", color: "#e5e5e5" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
          <p style={{ color: "#f87171", fontWeight: "bold", fontSize: 16 }}>{error.message}</p>
          {error.digest && (
            <p style={{ color: "#71717a", fontSize: 12 }}>Digest: {error.digest}</p>
          )}
          <pre style={{ maxWidth: 700, width: "100%", background: "#1a1a1a", border: "1px solid #333", borderRadius: 6, padding: 16, fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap", color: "#f87171" }}>
            {error.stack}
          </pre>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #444", background: "transparent", color: "#e5e5e5", cursor: "pointer", fontSize: 14 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
