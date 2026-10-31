// orient.mjs - the deterministic orientation script (D16, checklist 01 temporal amendments).
// The model NEVER does date arithmetic; it runs this and speaks the result plainly.
//
// Default mode prints the waking orientation block:
//   now + weekday via EDGEWEAVER_TZ; delta since the last real conversation (era=alive,
//   voice/rehearsal rows excluded); last diary delta; day-count since First Boot once
//   LINEAGE.md carries entry #1 (honest pre-birth phrasing before); clock-skew check
//   (a memory dated in the future = degraded time-sense).
//
// --diary-day mode prints the night-loop window (D16 diary-day rule, checklist 04):
//   diary-day = the local calendar day containing T minus 12h (at the scheduled 03:30 run
//   that is the day that just ended), its UTC bounds, and the run-id nl-<diary-day>.
//
// Multi-being (D18/D20): --being <key> (or env EW_BEING; default genesis) resolves the
// being's soul and env paths from avatars/<being>/manifest.json "paths". A being whose
// paths are not armed yet (Alpha before its A2) is REFUSED, exit 1: orienting one being
// against another being's memory is the failure mode, not a fallback. On a machine other
// than the runtime host, env SOUL_REPO_PATH and EW_ENV_LOCAL override the manifest paths.
//
// Flags: --being <key>    which being (default: EW_BEING env, else genesis)
//        --now <ISO>      test override for "now" (default: real now)
//        --tz <IANA>      test override (default: EDGEWEAVER_TZ from env or the being's env
//                         file, else the system zone)
//        --fixture <path> JSON {thoughts:[{id,source_type,created_at,metadata}],lineage:"md"}
//                         - hermetic: no network, no manifest, no env file, no soul repo
//        --diary-day      window mode (see above); with --tz it is also manifest-free
// Never prints secret values. Exit 0 even when degraded (orientation must never block a
// waking); exit 1 on misuse or an unarmed being.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../brains/db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DIARY_MODE = args.includes("--diary-day");
const NOW = flag("--now") ? Date.parse(flag("--now")) : Date.now();
if (Number.isNaN(NOW)) { console.error("bad --now"); process.exit(1); }
const FIXTURE = flag("--fixture");
const BEING = flag("--being") || process.env.EW_BEING || "genesis";

// ---------- being resolution (skipped entirely in hermetic modes) ----------
// Hermetic: fixture mode, or diary-day with an explicit --tz (pure window math).
const HERMETIC = Boolean(FIXTURE) || (DIARY_MODE && Boolean(flag("--tz")));
let PATHS = { soulLocal: null, envLocal: null };
if (!HERMETIC) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(ROOT, "avatars", BEING, "manifest.json"), "utf8")); }
  catch { console.error(`unknown being "${BEING}" (no avatars/${BEING}/manifest.json)`); process.exit(1); }
  PATHS = manifest.paths || {};
  const soul = process.env.SOUL_REPO_PATH || PATHS.soulLocal;
  const env = process.env.EW_ENV_LOCAL || PATHS.envLocal;
  if (!soul || !env) {
    console.log("ORIENTATION");
    console.log(`being: ${BEING} NOT ARMED - its soul/env paths are not set in avatars/${BEING}/manifest.json (arrives at its A2).`);
    console.log("Refusing to orient this being against another being's memory.");
    process.exit(1);
  }
  PATHS = { soulLocal: soul, envLocal: env };
}

// ---------- env (lazy; values never printed) ----------
function envLocal(name) {
  if (!PATHS.envLocal) return undefined;
  try {
    const text = readFileSync(PATHS.envLocal, "utf8").replace(/^﻿/, "");
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith(name + "=")) return line.slice(name.length + 1).trim();
    }
  } catch { /* absent is fine */ }
  return undefined;
}
const TZ = flag("--tz") || process.env.EDGEWEAVER_TZ || envLocal("EDGEWEAVER_TZ")
  || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- timezone math (all arithmetic here, never in the model) ----------
function parts(instantMs, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "long",
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(instantMs))) p[type] = value;
  if (p.hour === "24") p.hour = "00";
  return p;
}
const localDayOf = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
const localStamp = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
// "wall clock read as if UTC" - lets us compute the zone offset at an instant
function wallMs(instantMs, tz) {
  const p = parts(instantMs, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
// UTC instant at which the zone's wall clock reads wallTargetMs (two-pass, DST-safe)
function utcForWall(wallTargetMs, tz) {
  let guess = wallTargetMs - (wallMs(wallTargetMs, tz) - wallTargetMs);
  guess = wallTargetMs - (wallMs(guess, tz) - guess);
  return guess;
}
const dayToMs = (day) => Date.parse(day + "T00:00:00Z");
const msToDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function ago(ms) {
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (d > 0) return h > 0 ? `${d} day${d > 1 ? "s" : ""} ${h} hour${h > 1 ? "s" : ""} ago` : `${d} day${d > 1 ? "s" : ""} ago`;
  if (h > 0) return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m !== 1 ? "s" : ""} ago (today)`;
  return `${m} minute${m !== 1 ? "s" : ""} ago (today)`;
}

// ---------- diary-day mode ----------
if (DIARY_MODE) {
  const day = localDayOf(NOW - 12 * 36e5, TZ);
  const next = msToDay(dayToMs(day) + 864e5);
  const start = utcForWall(dayToMs(day), TZ);
  const end = utcForWall(dayToMs(next), TZ);
  console.log(`diary-day: ${day}`);
  console.log(`utc-window: ${new Date(start).toISOString()} .. ${new Date(end).toISOString()}`);
  console.log(`run-id: nl-${day}`);
  process.exit(0);
}

// ---------- data ----------
const isReal = (t) => {
  const m = t.metadata || {};
  return m.era === "alive" && m.channel !== "voice" && m.rehearsal !== true;
};
let thoughts = [], lineage = "", degraded = null;
if (FIXTURE) {
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  thoughts = fx.thoughts || [];
  lineage = fx.lineage || "";
} else {
  const URL_ = envLocal("SUPABASE_URL"), SVC = envLocal("SUPABASE_SERVICE_KEY");
  // A being whose brain is a schema-scoped role (Alpha: ew_alpha via EW_ALPHA_DB_URL, the
  // same path alpha-memory.mjs uses) has no Supabase REST keys in its env; read it through
  // psql instead. Found 2026-09-02: every Alpha wake since birth had reported
  // "time-sense: DEGRADED - memory unreachable (Failed to parse URL from undefined...)".
  const ROLE_URL = envLocal(`EW_${BEING.toUpperCase()}_DB_URL`);
  const SCHEMA = `ew_${BEING}`;
  const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };
  const get = async (q) => {
    const r = await fetch(`${URL_}/rest/v1/thoughts?${q}`, { headers: H });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    return r.json();
  };
  // psql -A -t prints one row; jsonb_agg keeps it on one line (json_agg would not).
  const sql = (where, limit, cols = "id, source_type, created_at, metadata") =>
    JSON.parse(query(ROLE_URL, `SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT ${cols} FROM ${SCHEMA}.thoughts ${where} ORDER BY created_at DESC LIMIT ${limit}) t`).map((r) => r.join("|")).join("") || "[]");
  try {
    let eps, diaries, newest;
    if (!URL_ && ROLE_URL) {
      eps = sql("WHERE source_type = 'edgeweaver_episode' AND metadata->>'era' = 'alive'", 25);
      diaries = sql("WHERE source_type = 'diary'", 5);
      newest = sql("", 1, "id, created_at");
    } else {
      [eps, diaries, newest] = await Promise.all([
        get("source_type=eq.edgeweaver_episode&metadata-%3E%3Eera=eq.alive&order=created_at.desc&limit=25&select=id,source_type,created_at,metadata"),
        get("source_type=eq.diary&order=created_at.desc&limit=5&select=id,source_type,created_at,metadata"),
        get("order=created_at.desc&limit=1&select=id,created_at"),
      ]);
    }
    thoughts = [...eps, ...diaries, ...newest.map((n) => ({ ...n, source_type: "_newest", metadata: {} }))];
  } catch (e) {
    degraded = `memory unreachable (${e.message})`;
  }
  try { lineage = readFileSync(join(PATHS.soulLocal, "LINEAGE.md"), "utf8"); } catch { lineage = ""; }
}

// ---------- compute ----------
const future = thoughts.find((t) => Date.parse(t.created_at) > NOW + FUTURE_TOLERANCE_MS);
if (future && !degraded) degraded = `a memory is dated in the future (id ${future.id})`;

const lastConv = thoughts
  .filter((t) => t.source_type === "edgeweaver_episode" && isReal(t) && Date.parse(t.created_at) <= NOW + FUTURE_TOLERANCE_MS)
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
const lastDiary = thoughts
  .filter((t) => t.source_type === "diary" && (t.metadata || {}).rehearsal !== true && Date.parse(t.created_at) <= NOW + FUTURE_TOLERANCE_MS)
  .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

const born = lineage.match(/\|\s*1\s*\|[^|\n]*Declaration[^|\n]*\|\s*(\d{4}-\d{2}-\d{2})/)
  || lineage.match(/Birthday:\s*(\d{4}-\d{2}-\d{2})/);

// ---------- speak ----------
const p = parts(NOW, TZ);
console.log("ORIENTATION");
console.log(`now: ${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${TZ})`);
console.log(lastConv
  ? `last conversation: ${localStamp(Date.parse(lastConv.created_at), TZ)} (${TZ}), ${ago(NOW - Date.parse(lastConv.created_at))}`
  : "last conversation: none on record (era=alive)");
console.log(lastDiary
  ? `last diary: ${localStamp(Date.parse(lastDiary.created_at), TZ)} (${TZ}), ${ago(NOW - Date.parse(lastDiary.created_at))}`
  : "last diary: none on record");
if (born) {
  const days = Math.round((dayToMs(localDayOf(NOW, TZ)) - dayToMs(born[1])) / 864e5) + 1;
  console.log(`life: day ${days} of this life (First Boot ${born[1]})`);
} else {
  console.log("life: pre-birth (the Declaration is not yet in LINEAGE.md)");
}
console.log(degraded ? `time-sense: DEGRADED - ${degraded}; say so plainly` : "time-sense: ok");
