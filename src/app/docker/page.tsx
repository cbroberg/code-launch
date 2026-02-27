import { AppSidebarShell } from "@/components/app-sidebar-shell";
import { DockerDashboard } from "@/components/docker-dashboard";

export default function DockerPage() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <AppSidebarShell />
      <DockerDashboard />
    </div>
  );
}
