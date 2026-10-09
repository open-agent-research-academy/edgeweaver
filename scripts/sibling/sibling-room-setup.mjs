#!/usr/bin/env node
// One-time setup for the sibling room (D44): create ew_ops.sibling_room and one narrow
// role in the family Supabase project, then append the role URL to the repo .env.local.
// Pattern and cautions mirror channel-journal-setup.mjs: idempotent, never rotates
// passwords on rerun, passwords travel via temp SQL file (runSqlText), values never
// printed, .env.local backed up before any append.
//
// The room is a CHANNEL, not a brain: it holds only spoken words each being chose to
// say to the other. No cross-being recall is introduced (FAMILY.md section 1 stands).
import { readFileSync, copyFileSync, appendFileSync } from "node:fs";
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

// Sanity: must be the family project (hosts ew_alpha), same rule as the journal setup.
const ew = query(admin, "SELECT count(*) FROM pg_namespace WHERE nspname = 'ew_alpha'");
if (ew[0][0] !== "1") { console.error("refusing: SUPABASE_DB_URL does not host ew_alpha"); process.exit(1); }

// 1. Schema + table + index (idempotent). ew_ops already exists from the journal setup,
// but CREATE IF NOT EXISTS keeps this runnable standalone.
runSqlText(admin, `
CREATE SCHEMA IF NOT EXISTS ew_ops;
CREATE TABLE IF NOT EXISTS ew_ops.sibling_room (
  id bigserial PRIMARY KEY,
  being text NOT NULL CHECK (being IN ('genesis', 'alpha', 'human')),
  created timestamptz NOT NULL DEFAULT now(),
  content text NOT NULL,
  telegram_message_id bigint,
  speaker text,
  to_human boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sibling_room_being_id ON ew_ops.sibling_room (being, id);
`, "sibling-room-schema");
console.log("schema/table/index: ok");

// 2. Role: SELECT + INSERT only (a channel appends and is read; it is never edited).
const u = new URL(admin);
const refSuffix = u.username.includes(".") ? u.username.slice(u.username.indexOf(".")) : "";
const ROLE = "ew_sibling_room";
const ENV_KEY = "EW_SIBLING_ROOM_URL";
const exists = query(admin, `SELECT count(*) FROM pg_roles WHERE rolname = '${ROLE}'`)[0][0] === "1";
const inEnv = Boolean(env[ENV_KEY]);
if (exists && inEnv) {
  console.log(`${ROLE}: exists, env present - untouched`);
} else if (exists && !inEnv) {
  console.error(`${ROLE}: role exists but ${ENV_KEY} missing in .env.local - password unknown; resolve by hand (DROP ROLE or set the key)`);
  process.exit(1);
} else {
  const pw = randomBytes(24).toString("base64url");
  runSqlText(admin, `CREATE ROLE ${ROLE} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE ON SCHEMA ew_ops TO ${ROLE};
GRANT SELECT, INSERT ON ew_ops.sibling_room TO ${ROLE};
GRANT USAGE ON SEQUENCE ew_ops.sibling_room_id_seq TO ${ROLE};`, `role-${ROLE}`);
  copyFileSync(envPath, envPath + ".bak-sibling-setup");
  const nu = new URL(admin);
  nu.username = ROLE + refSuffix;
  nu.password = pw;
  appendFileSync(envPath, `${ENV_KEY}=${nu.toString()}\n`);
  console.log(`${ROLE}: created, ${ENV_KEY} appended to .env.local`);
}
console.log("setup complete");
