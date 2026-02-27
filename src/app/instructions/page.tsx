import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, ExternalLink, Terminal, Code2, Zap, BookOpen } from "lucide-react";
import { AppSidebarShell } from "@/components/app-sidebar-shell";

function CodeBlock({ children, language = "bash" }: { children: string; language?: string }) {
  return (
    <div className="relative rounded-md border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted text-xs text-muted-foreground">
        <span>{language}</span>
      </div>
      <pre className="p-4 text-sm overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

export default function InstructionsPage() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">

      <AppSidebarShell />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              Using the API from other apps
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">
              How to integrate Code Launcher into your projects — auto-assign ports, generate clients, and use the OpenAPI spec.
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs">http://localhost:4200</Badge>
              <a
                href="/openapi.yaml"
                target="_blank"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                openapi.yaml <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="space-y-6">

            <Section icon={<Zap className="h-5 w-5 text-primary" />} title="Get the next free port">
              <p className="text-sm text-muted-foreground">
                The most common use case — ask the registry for a port that isn&apos;t taken before starting a new project.
              </p>
              <CodeBlock language="bash">{`# One-liner: grab next free port
PORT=$(curl -s http://localhost:4200/api/vacant-port | python3 -c \\
  "import sys,json; print(json.load(sys.stdin)['port'])")

echo "Starting on port $PORT"
next dev -p $PORT`}</CodeBlock>

              <CodeBlock language="typescript">{`// In a setup script or Claude tool
const res = await fetch("http://localhost:4200/api/vacant-port");
const { port } = await res.json();
// port: 3002`}</CodeBlock>
            </Section>

            <Section icon={<Database className="h-5 w-5 text-primary" />} title="Register a new app">
              <p className="text-sm text-muted-foreground">
                After picking a port, register the app so future calls to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/vacant-port</code> skip it.
              </p>
              <CodeBlock language="bash">{`curl -s -X POST http://localhost:4200/api/apps \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-new-app",
    "port": 3002,
    "githubName": "cbroberg/my-new-app",
    "localPath": "/Users/cb/Apps/cbroberg/my-new-app"
  }'`}</CodeBlock>
              <CodeBlock language="typescript">{`await fetch("http://localhost:4200/api/apps", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "my-new-app",
    port: 3002,
    githubName: "cbroberg/my-new-app",
    localPath: "/Users/cb/Apps/cbroberg/my-new-app",
  }),
});`}</CodeBlock>
              <p className="text-xs text-muted-foreground">
                Returns <code className="bg-muted px-1 py-0.5 rounded">409</code> if the port is already taken — handle it by fetching a new vacant port and retrying.
              </p>
            </Section>

            <Section icon={<Code2 className="h-5 w-5 text-primary" />} title="Generate a typed client">
              <p className="text-sm text-muted-foreground">
                Use <strong>openapi-typescript</strong> to generate a fully typed client from the spec — no manual types needed.
              </p>
              <CodeBlock language="bash">{`# Install once
npm install -D openapi-typescript

# Generate types into your project
npx openapi-typescript http://localhost:4200/openapi.yaml \\
  -o src/lib/ports-db.d.ts`}</CodeBlock>
              <CodeBlock language="typescript">{`// Use with openapi-fetch for end-to-end types
import createClient from "openapi-fetch";
import type { paths } from "./ports-db.d.ts";

const client = createClient<paths>({ baseUrl: "http://localhost:4200" });

const { data } = await client.GET("/api/vacant-port");
//    ^? { port: number }

const { data: app } = await client.POST("/api/apps", {
  body: { name: "my-app", port: data.port },
});`}</CodeBlock>
            </Section>

            <Section icon={<Terminal className="h-5 w-5 text-primary" />} title="Use with Claude / AI agents">
              <p className="text-sm text-muted-foreground">
                Point Claude (or any OpenAPI-aware tool) at the spec URL and it can call the API autonomously when bootstrapping new projects.
              </p>
              <CodeBlock language="markdown">{`<!-- In CLAUDE.md or system prompt -->
## Port management

Before starting any new dev server or creating a project, check
which ports are available:

  GET http://localhost:4200/api/vacant-port

Then register the app after creating it:

  POST http://localhost:4200/api/apps
  { "name": "...", "port": ..., "localPath": "..." }

Full spec: http://localhost:4200/openapi.yaml`}</CodeBlock>
              <p className="text-sm text-muted-foreground">
                The spec is served as a static file — no auth, always available while the registry is running.
              </p>
            </Section>

            <Section icon={<ExternalLink className="h-5 w-5 text-primary" />} title="Import into Postman or Insomnia">
              <p className="text-sm text-muted-foreground">
                Both tools can import directly from a URL — no download needed.
              </p>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-1">Postman</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Click <strong>Import</strong> → <strong>Link</strong></li>
                    <li>Paste <code className="bg-muted px-1 py-0.5 rounded text-xs">http://localhost:4200/openapi.yaml</code></li>
                    <li>Click <strong>Import</strong> — all endpoints appear as a collection</li>
                  </ol>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Insomnia</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Click <strong>Import</strong> → <strong>From URL</strong></li>
                    <li>Paste <code className="bg-muted px-1 py-0.5 rounded text-xs">http://localhost:4200/openapi.yaml</code></li>
                  </ol>
                </div>
              </div>
            </Section>

            <Section icon={<Database className="h-5 w-5 text-primary" />} title="Endpoint quick reference">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left pb-2 font-medium text-muted-foreground w-8">Method</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground pl-3">Path</th>
                      <th className="text-left pb-2 font-medium text-muted-foreground pl-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[
                      ["GET",    "/api/vacant-port",  "First free port ≥ 3000"],
                      ["GET",    "/api/apps",          "List all registered apps"],
                      ["POST",   "/api/apps",          "Register a new app"],
                      ["PATCH",  "/api/apps/:id",      "Update name / port / path"],
                      ["DELETE", "/api/apps/:id",      "Remove app from registry"],
                      ["POST",   "/api/scan",          "Scan ~/Apps and auto-register"],
                    ].map(([method, path, desc]) => (
                      <tr key={path + method}>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={`font-mono text-xs ${
                              method === "GET" ? "text-emerald-600 border-emerald-200" :
                              method === "POST" ? "text-blue-600 border-blue-200" :
                              method === "PATCH" ? "text-amber-600 border-amber-200" :
                              "text-red-600 border-red-200"
                            }`}
                          >
                            {method}
                          </Badge>
                        </td>
                        <td className="py-2 pl-3 font-mono text-xs">{path}</td>
                        <td className="py-2 pl-3 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

          </div>
        </div>
      </main>

    </div>
  );
}
