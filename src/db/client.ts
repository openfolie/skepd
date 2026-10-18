import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(path: string): { raw: Database.Database; db: Db } {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  return { raw, db };
}

export function runMigrations(raw: Database.Database, migrationsDir: string): void {
  raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const appliedRows = raw.prepare("SELECT name FROM _migrations").all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    raw.exec("BEGIN");
    try {
      raw.exec(sql);
      raw.prepare("INSERT INTO _migrations(name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  }
}