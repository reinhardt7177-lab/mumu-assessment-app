import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Link the correct Vercel project, provision Neon, and pull environment variables before running migrations.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
await sql.query("CREATE TABLE IF NOT EXISTS mumu_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
const directory = new URL("../db/migrations/", import.meta.url);
for (const name of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
  const source = await readFile(new URL(name, directory), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  const prior = await sql.query("SELECT checksum FROM mumu_schema_migrations WHERE name = $1", [name]);
  if (prior[0]) {
    if (prior[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}. Add a new migration instead.`);
    console.log(`Already applied: ${name}`);
    continue;
  }
  const statements = source.split("-- statement-breakpoint").map(value => value.trim()).filter(Boolean);
  await sql.transaction([
    ...statements.map(statement => sql.query(statement)),
    sql.query("INSERT INTO mumu_schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]),
  ]);
  console.log(`Applied: ${name}`);
}
console.log("Schema ready. No student or demo records were seeded.");
