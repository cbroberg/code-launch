import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { AppDashboard } from "@/components/app-dashboard";

export default async function Home() {
  const allApps = await db.select().from(apps).orderBy(apps.name);
  return <AppDashboard apps={allApps} />;
}
