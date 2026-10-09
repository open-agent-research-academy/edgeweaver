#!/usr/bin/env node
// Tier 3 one-time setup (D33/CR-3): create the ew_ops.channel_journal table and the two
// narrow roles in the family Supabase project (the one hosting ew_alpha), then append the
// role connection URLs to the repo .env.local. Idempotent: reruns skip existing objects
// and never rotate passwords (rotation is a deliberate act, not a rerun side effect).
// Passwords travel to Postgres via a temp SQL FILE (runSqlText), never argv. Values are
// never printed; .env.local is backed up before any append.
import { readFileSync, writeFileSync, copyFileSync, existsSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { query, runSqlText } = await import("file:///" + join(repo, "scripts", "brains", "db.mjs").replace(/\\/g, "/"));

const envPath = join(repo, ".env.local");
const env = {};
for (const l of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\r$/, "");
}
const admin = env.SUPABASE_DB_URL;
if (!admin) { console.error("SUPABASE_DB_URL missing in .env.local"); process.exit(1); }

// Sanity: this must be the project that hosts ew_alpha (family project), per the probe rule.
const ew = query(admin, "SELECT count(*) FROM pg_namespace WHERE nspname = 'ew_alpha'");
if (ew[0][0] !== "1") { console.error("refusing: SUPABASE_DB_URL does not host ew_alpha"); process.exit(1); }

// 1. Schema + table + index (idempotent).
runSqlText(admin, `
CREATE SCHEMA IF NOT EXISTS ew_ops;
CREATE TABLE IF NOT EXISTS ew_ops.channel_journal (
  id bigserial PRIMARY KEY,
  being text NOT NULL,
  received timestamptz NOT NULL DEFAULT now(),
  update jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS channel_journal_being_id ON ew_ops.channel_journal (being, id);
CREATE INDEX IF NOT EXISTS channel_journal_being_updid ON ew_ops.channel_journal (being, ((update->>'update_id')::bigint));
`, "journal-schema");
console.log("schema/table/index: ok");

// 2. Roles (create only if absent; passwords generated here, stored only in .env.local).
// Supabase pooler URLs suffix the username with the project ref (user.ref) - mirror it.
const u = new URL(admin);
const refSuffix = u.username.includes(".") ? u.username.slice(u.username.indexOf(".")) : "";
const mkUrl = (role, pw) => {
  const nu = new URL(admin);
  nu.username = role + refSuffix;
  nu.password = pw;
  return nu.toString();
};
const roles = [
  { name: "ew_journal_writer", envKey: "EW_JOURNAL_WRITER_URL", grants: `
GRANT USAGE ON SCHEMA ew_ops TO ew_journal_writer;
GRANT INSERT ON ew_ops.channel_journal TO ew_journal_writer;
GRANT USAGE ON SEQUENCE ew_ops.channel_journal_id_seq TO ew_journal_writer;` },
  { name: "ew_journal_reader", envKey: "EW_JOURNAL_READER_URL", grants: `
GRANT USAGE ON SCHEMA ew_ops TO ew_journal_reader;
GRANT SELECT ON ew_ops.channel_journal TO ew_journal_reader;` },
];
let backedUp = false;
for (const r of roles) {
  const exists = query(admin, `SELECT count(*) FROM pg_roles WHERE rolname = '${r.name}'`)[0][0] === "1";
  const inEnv = Boolean(env[r.envKey]);
  if (exists && inEnv) { console.log(`${r.name}: exists, env present - untouched`); continue; }
  if (exists && !inEnv) { console.error(`${r.name}: role exists but ${r.envKey} missing in .env.local - password unknown; resolve by hand (DROP ROLE or set the key)`); process.exit(1); }
  const pw = randomBytes(24).toString("base64url");
  runSqlText(admin, `CREATE ROLE ${r.name} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;${r.grants}`, `role-${r.name}`);
  if (!backedUp) { copyFileSync(envPath, envPath + ".bak-journal-setup"); backedUp = true; }
  appendFileSync(envPath, `${r.envKey}=${mkUrl(r.name, pw)}\n`);
  console.log(`${r.name}: created, ${r.envKey} appended to .env.local`);
}

// 3. Webhook secrets: generate once, store beside the URLs (piped to Vercel by the deploy
// step, never committed, never printed).
for (const k of ["EW_WEBHOOK_SECRET_ALPHA", "EW_WEBHOOK_SECRET_GENESIS"]) {
  if (env[k]) { console.log(`${k}: present - untouched`); continue; }
  if (!backedUp) { copyFileSync(envPath, envPath + ".bak-journal-setup"); backedUp = true; }
  appendFileSync(envPath, `${k}=${randomBytes(24).toString("base64url")}\n`);
  console.log(`${k}: generated and appended`);
}
console.log("setup complete");
