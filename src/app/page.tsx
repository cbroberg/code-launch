import Link from "next/link";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppsTable } from "@/components/apps-table";
import { ScanButton } from "@/components/scan-button";
import { VacantPortBadge } from "@/components/vacant-port-badge";
import { Database, Globe, Server, BookOpen } from "lucide-react";

export default async function Home() {
  const allApps = await db.select().from(apps).orderBy(apps.port);

  const withPort = allApps.filter((a) => a.port !== null).length;
  const withGithub = allApps.filter((a) => a.githubName !== null).length;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Database className="h-8 w-8 text-primary" />
              App Ports DB
            </h1>
            <p className="mt-1 text-muted-foreground">
              Local port registry for development projects
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/instructions"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              API docs
            </Link>
            <VacantPortBadge />
            <ScanButton />
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Apps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{allApps.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Server className="h-3.5 w-3.5" /> With Port
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{withPort}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" /> On GitHub
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{withGithub}</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <AppsTable apps={allApps} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
