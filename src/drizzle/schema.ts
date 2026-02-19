import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  githubName: text("github_name"),
  githubUrl: text("github_url"),
  port: integer("port").unique(),
  localPath: text("local_path"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
