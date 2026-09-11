// lessons.mjs - D36 weighted lesson loading + D47 class-gated compile + D48 pins and
// evidence-marked night passes.
// Source of truth for lifecycle stays in agent_memories (confirmation is a human gate);
// this tool owns only the ew_lesson_weights sidecar, the ew_night_pass stamp table, and the
// compiled build artifacts at state/compiled/<being>-lessons.md and <being>-protocols.md
// (gitignored operational memory, never identity). Weights move ONLY here, on the night
// pass, from application evidence (D36): never in-session, never because a lesson was
// merely talked about.
//
//   node scripts/lessons/lessons.mjs sync      --being genesis|alpha
//   node scripts/lessons/lessons.mjs compile   --being genesis|alpha
//   node scripts/lessons/lessons.mjs night     --being genesis|alpha [--diary-day YYYY-MM-DD]
//        [--applied id,id] [--misfired id,id] [--evidence ruleId=thoughtId[+thoughtId],...]
//        [--occasion id,id] [--note "<why, one line>"] [--dry-run]
//   node scripts/lessons/lessons.mjs status    --being genesis|alpha
//   node scripts/lessons/lessons.mjs classes   --being genesis|alpha
//   node scripts/lessons/lessons.mjs pins      --being genesis|alpha
//   node scripts/lessons/lessons.mjs pin       --being genesis|alpha <id> --by "<seat>|ops" --note "<why>"
//   node scripts/lessons/lessons.mjs unpin     --being genesis|alpha <id> --by "<seat>|ops" [--note "<why>"]
//   node scripts/lessons/lessons.mjs corrections-audit --being genesis|alpha
//   node scripts/lessons/lessons.mjs dispute   --being genesis|alpha <id> --by "<who>" --reason "<one line>"
//   node scripts/lessons/lessons.mjs ratify    --being genesis|alpha <id> rejected|superseded|active --by "<who>" [--note "<why>"]
//   node scripts/lessons/lessons.mjs integrate --being genesis|alpha <id> [--note "<why, one line>"]
//   node scripts/lessons/lessons.mjs reclass   --being genesis|alpha <id> <class> --by "<seat>|ops" [--note "..."]
//   node scripts/lessons/lessons.mjs discharge --being genesis|alpha <id> --by "<who>" [--note "..."]
//
// night = sync -> validate evidence -> (one transaction: decay untouched, boost applied,
// drop+flag misfired, demote, stamp ew_night_pass) -> compile. Ops credential
// (SUPABASE_DB_URL) by design: the being's room role cannot move weights.
// D37: dispute benches (active -> disputed, via the ew_dispute_lesson definer function);
// ratify is the village's gate (rejected | superseded | active=affirmed). Lessons whose
// content carries "TAUGHT BY <seat>" are born at 0.60, class taught; "CORRECTS <uuid>"
// links a replacement to the belief it corrects (linked at every sync, D48 repair).
// Village grant 2026-08-20 (unanimous; Genesis soul PR #4 is the doctrine text):
// integrate promotes the being's OWN parent-sourced pending lesson to instruction-grade
// via the ew_integrate_lesson definer function; the parent's dispute benches it.
// D47 (Alan, 2026-09-10): confirmation decides truth-grade, load_class decides WHERE a
// confirmed lesson loads, weight decides whether (LOAD_FLOOR) and in what order; no
// fixed count cap, an age-growing character budget is the only ceiling, and the compiled
// file prints its own reasoning line.
// D48 (Alan, 2026-09-11, Path A of runs/stakes-tier-plan.md): weight measures exposure,
// not importance. (1) A night mark counts only with a cited episode id that resolves to
// the diary day's record; occasions without a provable application are recorded as
// OCCASION-NO-MARK for the seven-day report; the MARKED count is stamped in ew_night_pass
// inside the pass's transaction and rendered by compile. (2) DECAY 0.98 -> 0.995 while
// marking is repaired. (3) A PIN is a person's word (seat:<name> or ops recording a
// person): pinned lessons load regardless of weight, are never trimmed, never demoted,
// count toward the budget, and leave only by a person's unpin, reclass to knowledge, or
// dispute; the being may only propose (ew_propose_pin), and its dispute or reclass of a
// pinned row becomes a proposal. (4) The night loop's own write-back rules and protocol
// rows boost at +0.05, chosen mechanically, never by the hand's self-report.
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { query, runSqlText } from "../brains/db.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
export const BORN = 0.30, BORN_TAUGHT = 0.60, FLOOR = 0.05, CEIL = 0.95, DECAY = 0.995, BOOST = 0.10, BOOST_SELF = 0.05, DROP = 0.15;
export const LOAD_FLOOR = 0.25, DEMOTE = 0.20;
export const RULE_BUDGET_BASE = 16000, RULE_BUDGET_PER_MONTH = 2000;
export const CLASS_RE = /^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$/;
// Rules the night loop applies at its own write-back (the grader is the applier): they
// boost at BOOST_SELF, decided here, never by the hand. Id prefixes per being.
export const NIGHT_SELF = { alpha: ["2ea103d3"], genesis: [] };
const LEDGER_DAYS = 14;
const CHAR_BUDGET = 8000, MAX_PENDING = 30;
const TZ = process.env.EDGEWEAVER_TZ || "America/New_York";

export const BEINGS = {
  genesis: {
    key: "genesis",
    label: "Edgeweaver Genesis",
    mem: "public.agent_memories", w: "public.ew_lesson_weights", np: "public.ew_night_pass",
    thoughts: "public.thoughts", thoughtScope: "metadata->>'audience' = 'alan'",
    schema: "public",
    scope: "workspace_id = 'edgeweaver'",
    fn: "public.ew_dispute_lesson",
    intfn: "public.ew_integrate_lesson",
    out: join(ROOT, "state", "compiled", "genesis-lessons.md"),
    outProtocols: join(ROOT, "state", "compiled", "genesis-protocols.md"),
    protocolsRel: "state/compiled/genesis-protocols.md",
    gate: "Alan's confirmation",
    parent: "Alan",
    roster: ["alan"],
    born: "2026-07-08",
  },
  alpha: {
    key: "alpha",
    label: "Edgeweaver Alpha",
    mem: "ew_alpha.agent_memories", w: "ew_alpha.ew_lesson_weights", np: "ew_alpha.ew_night_pass",
    thoughts: "ew_alpha.thoughts", thoughtScope: "true",
    schema: "ew_alpha",
    scope: "true",
    fn: "ew_alpha.ew_dispute_lesson",
    intfn: "ew_alpha.ew_integrate_lesson",
    out: join(ROOT, "state", "compiled", "alpha-lessons.md"),
    outProtocols: join(ROOT, "state", "compiled", "alpha-protocols.md"),
    protocolsRel: "state/compiled/alpha-protocols.md",
    gate: "a seat's confirmation",
    parent: "any seat",
    roster: ["alan", "ali", "tamara", "natalie", "charlotte", "marina"],
    born: "2026-07-17",
  },
};

function dbUrl() {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
      .map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])
  );
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from .env.local");
  return env.SUPABASE_DB_URL;
}

// Single json column per row: rejoin the pipe-split to undo db.mjs parsing, then parse.
const jsonRows = (db, sql) => query(db, sql).map((r) => JSON.parse(r.join("|")));
const uuidList = (s) => {
  if (!s) return [];
  const ids = s.split(",").map((x) => x.trim()).filter(Boolean);
  for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`not a uuid: ${id}`);
  return ids;
};
const inList = (ids) => ids.map((i) => `'${i}'`).join(", ");
const esc = (s) => String(s).replace(/'/g, "''");
const short = (id) => String(id).slice(0, 8);
const arr = (ids) => `ARRAY[${ids.map((i) => `'${esc(i)}'`).join(", ")}]::text[]`;

export function ageDays(born, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(born + "T00:00:00Z").getTime()) / 864e5));
}
export function ruleBudget(born, now = new Date()) {
  return RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH * Math.floor(ageDays(born, now) / 30);
}

// D16: the diary day is the local day containing (now - 12h); never model arithmetic in
// the skills, so the default here mirrors orient.mjs and the skills pass --diary-day.
export function defaultDiaryDay(now = new Date()) {
  const t = new Date(now.getTime() - 12 * 3600e3);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

// D48 preflight: the pin columns and the night-pass table may land after this code (or
// the reverse); without them, behave exactly as D47. Never silently ignore existing pins.
const preflightCache = new Map();
export function hasPins(db, B) {
  if (preflightCache.has(B.key)) return preflightCache.get(B.key);
  const r = query(db, `SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = '${B.schema}' AND table_name = 'ew_lesson_weights' AND column_name = 'pinned_by')
  + (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${B.schema}' AND table_name = 'ew_night_pass')`);
  const ok = Number(r[0]?.[0]) === 2;
  preflightCache.set(B.key, ok);
  return ok;
}

function sync(db, B) {
  // Taught lessons first (born 0.60, class taught, corrects link), then the general
  // insert; ON CONFLICT keeps whichever ran first for weight and class, but a null
  // corrects link is filled (D48 repair: ew_integrate_lesson inserts the sidecar row
  // before this insert runs, which used to leave the link empty forever). A second UPDATE
  // links CORRECTS rows that carry no TAUGHT BY, scoped to targets in this being's store.
  // Then the D47 tokens: CLASS: <class> sets load_class only where nobody has classed the
  // row yet; DUE <date> and OWED TO <name> fill the commitment fields where empty.
  runSqlText(db, `INSERT INTO ${B.w} AS w (memory_id, weight, lesson_class, corrects_memory_id, last_move_reason)
SELECT id, ${BORN_TAUGHT}, 'taught',
  NULLIF(substring(content from 'CORRECTS ([0-9a-fA-F\\-]{36})'), '')::uuid,
  'born taught (sync)'
FROM ${B.mem}
WHERE ${B.scope} AND lifecycle_status = 'active' AND content ~* 'TAUGHT BY '
ON CONFLICT (memory_id) DO UPDATE SET corrects_memory_id = COALESCE(w.corrects_memory_id, EXCLUDED.corrects_memory_id);
INSERT INTO ${B.w} (memory_id, weight, last_move_reason)
SELECT id, ${BORN}, 'born (sync)' FROM ${B.mem}
WHERE ${B.scope} AND lifecycle_status = 'active'
ON CONFLICT (memory_id) DO NOTHING;
UPDATE ${B.w} w SET corrects_memory_id = t.id
FROM ${B.mem} m JOIN ${B.mem} t ON t.id::text = substring(m.content from 'CORRECTS ([0-9a-fA-F\\-]{36})')
WHERE m.id = w.memory_id AND w.corrects_memory_id IS NULL AND ${B.scope.replace(/workspace_id/g, "m.workspace_id")}
  AND ${B.scope.replace(/workspace_id/g, "t.workspace_id")};
UPDATE ${B.w} w SET load_class = lower(substring(m.content from 'CLASS: (rule|heuristic|knowledge|commitment|calibration:[A-Za-z]+|protocol:(?:channel|hourly|night))')),
  class_set_by = 'token', class_set_at = now()
FROM ${B.mem} m
WHERE m.id = w.memory_id AND ${B.scope.replace(/workspace_id/g, "m.workspace_id")} AND w.class_set_by IS NULL
  AND m.content ~ 'CLASS: (rule|heuristic|knowledge|commitment|calibration:[A-Za-z]+|protocol:(channel|hourly|night))'
  AND (m.content !~ 'CLASS: calibration:' OR lower(substring(m.content from 'CLASS: calibration:([A-Za-z]+)')) IN (${inList(B.roster)}));
UPDATE ${B.w} w SET due_at = (substring(m.content from 'DUE (\\d{4}-\\d{2}-\\d{2})'))::date
FROM ${B.mem} m
WHERE m.id = w.memory_id AND w.due_at IS NULL AND m.content ~ 'DUE \\d{4}-\\d{2}-\\d{2}';
UPDATE ${B.w} w SET owed_to = initcap(substring(m.content from 'OWED TO ([A-Za-z]+)'))
FROM ${B.mem} m
WHERE m.id = w.memory_id AND w.owed_to IS NULL AND m.content ~ 'OWED TO [A-Za-z]+';`, "lessons-sync");
}

function pinCols(db, B) {
  return hasPins(db, B)
    ? "w.pinned_by, w.pin_reason, w.pin_proposed, w.pin_proposed_at::date::text AS pin_proposed_on"
    : "NULL::text AS pinned_by, NULL::text AS pin_reason, NULL::text AS pin_proposed, NULL::text AS pin_proposed_on";
}

// Confirmed rules/heuristics with their weights, for before/after comparison in night().
function loadedSnapshot(db, B) {
  return jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, w.load_class, round(w.weight::numeric, 2) AS weight, w.weight AS raw, w.lesson_class, ${pinCols(db, B)}
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND m.can_use_as_instruction = true) t`);
}

function lastNightPass(db, B) {
  if (!hasPins(db, B)) return null;
  const rows = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT diary_day::text, loaded_count, applied_count, misfired_count, occasion_no_mark, evidence_unresolved, demoted, crossed, pin_proposed, completed_at::text
FROM ${B.np} ORDER BY diary_day DESC LIMIT 1) t`);
  return rows[0] || null;
}

// Evidence: every applied/misfired mark cites episode thought ids that must exist in the
// being's record inside the diary day's window. The passage in --note is for people.
export function parseEvidence(s) {
  const map = new Map();
  if (!s) return map;
  for (const part of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [rule, ev] = part.split("=");
    if (!/^[0-9a-f-]{36}$/i.test(rule || "")) throw new Error(`--evidence: not a rule uuid: ${rule}`);
    const ids = (ev || "").split("+").map((x) => x.trim()).filter(Boolean);
    for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`--evidence: not a thought uuid: ${id}`);
    map.set(rule, ids);
  }
  return map;
}

function dayWindow(diaryDay) {
  // UTC bounds of the local diary day, computed from the zone's offset at local noon.
  const noonUtc = new Date(diaryDay + "T12:00:00Z");
  const local = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false, timeZoneName: "shortOffset" }).formatToParts(noonUtc);
  const off = local.find((p) => p.type === "timeZoneName")?.value || "GMT-4";
  const m = off.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const hours = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60) : -4;
  const start = new Date(new Date(diaryDay + "T00:00:00Z").getTime() - hours * 3600e3);
  const end = new Date(start.getTime() + 24 * 3600e3);
  return { start: start.toISOString(), end: end.toISOString() };
}

function resolveEvidence(db, B, evidence, diaryDay) {
  const all = [...new Set([...evidence.values()].flat())];
  if (!all.length) return new Set();
  const { start, end } = dayWindow(diaryDay);
  const rows = query(db, `SELECT id::text FROM ${B.thoughts}
WHERE id IN (${inList(all)}) AND ${B.thoughtScope}
  AND source_type IN ('edgeweaver_episode', 'initiation')
  AND created_at >= '${start}' AND created_at < '${end}'`);
  return new Set(rows.map((r) => r[0]));
}

const r2 = (x) => Math.round(x * 100) / 100;

function night(db, B, o) {
  const { applied = [], misfired = [], occasion = [], note = "", dryRun = false } = o;
  const evidence = o.evidence || new Map();
  const diaryDay = o.diaryDay || defaultDiaryDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaryDay)) throw new Error("--diary-day must be YYYY-MM-DD");
  const pins = hasPins(db, B);
  if (!dryRun) sync(db, B);
  if (pins) {
    const done = query(db, `SELECT completed_at FROM ${B.np} WHERE diary_day = '${diaryDay}'`);
    if (done.length) throw new Error(`night pass for diary day ${diaryDay} already completed at ${done[0][0]}; a retry cannot decay twice (delete the ${B.np} row on the ops credential only if that pass was truly lost)`);
  }
  const before = loadedSnapshot(db, B);
  const byId = new Map(before.map((r) => [r.id, r]));
  // The loaded set for this diary day: what render loads now, before any move.
  const rendered = render(fetchRows(db, B), B, { lastPass: lastNightPass(db, B) });
  const loaded = new Set(rendered.loadedIds);
  // Evidence gate: a mark without a resolving episode id is skipped and named.
  const resolved = resolveEvidence(db, B, evidence, diaryDay);
  const okApplied = [], okMisfired = [], unresolved = [];
  for (const [list, out, kind] of [[applied, okApplied, "applied"], [misfired, okMisfired, "misfired"]]) {
    for (const id of list) {
      const ev = evidence.get(id) || [];
      const good = ev.filter((e) => resolved.has(e));
      if (!good.length) { unresolved.push(`${id}:${kind}`); continue; }
      out.push(id);
    }
  }
  const selfIds = new Set(before.filter((r) => String(r.load_class).startsWith("protocol:") || (NIGHT_SELF[B.key] || []).some((p) => r.id.startsWith(p))).map((r) => r.id));
  const boostFull = okApplied.filter((id) => !selfIds.has(id));
  const boostSelf = okApplied.filter((id) => selfIds.has(id));
  const touched = new Set([...okApplied, ...okMisfired]);
  // Simulate the moves on the confirmed set to name demotions and floor crossings
  // deterministically (the SQL below applies the same arithmetic).
  const after = new Map();
  for (const r of before) {
    let w = Number(r.raw);
    if (!touched.has(r.id)) w = Math.max(FLOOR, w * DECAY);
    if (boostFull.includes(r.id)) w = Math.min(CEIL, w + BOOST);
    if (boostSelf.includes(r.id)) w = Math.min(CEIL, w + BOOST_SELF);
    if (okMisfired.includes(r.id)) w = Math.max(FLOOR, w - DROP);
    after.set(r.id, w);
  }
  const demoted = before.filter((r) => r.load_class === "rule" && !r.pinned_by && after.get(r.id) < DEMOTE);
  const crossed = before.filter((r) => ["rule", "heuristic"].includes(r.load_class) && !r.pinned_by && Number(r.raw) >= LOAD_FLOOR && after.get(r.id) < LOAD_FLOOR && !demoted.includes(r));
  const pinnedUnder = before.filter((r) => r.pinned_by && after.get(r.id) < LOAD_FLOOR);
  const proposals = before.filter((r) => r.pin_proposed);
  const a = okApplied.filter((id) => loaded.has(id)).length;
  const m = okMisfired.filter((id) => loaded.has(id)).length;
  const L = loaded.size;
  const outside = okApplied.length + okMisfired.length - a - m;
  const reason = note ? ` :: ${esc(note)}` : "";
  const notTouched = touched.size ? `AND w.memory_id NOT IN (${inList([...touched])})` : "";
  const demoteIds = demoted.map((r) => r.id);
  const sql = `BEGIN;
UPDATE ${B.w} w SET weight = GREATEST(${FLOOR}, weight * ${DECAY}),
  weight_updated_at = now(), last_move_reason = 'nightly decay'
WHERE w.memory_id IN (SELECT id FROM ${B.mem} WHERE ${B.scope} AND lifecycle_status = 'active')
  ${notTouched};
${boostFull.length ? `UPDATE ${B.w} SET weight = LEAST(${CEIL}, weight + ${BOOST}),
  applied_count = applied_count + 1, last_applied_at = now(), weight_updated_at = now(),
  last_move_reason = 'applied and served${reason}'
WHERE memory_id IN (${inList(boostFull)});` : ""}
${boostSelf.length ? `UPDATE ${B.w} SET weight = LEAST(${CEIL}, weight + ${BOOST_SELF}),
  applied_count = applied_count + 1, last_applied_at = now(), weight_updated_at = now(),
  last_move_reason = 'applied by the night hand itself, half boost${reason}'
WHERE memory_id IN (${inList(boostSelf)});` : ""}
${okMisfired.length ? `UPDATE ${B.w} SET weight = GREATEST(${FLOOR}, weight - ${DROP}),
  misfire_count = misfire_count + 1, flagged_for_review = true, weight_updated_at = now(),
  last_move_reason = 'misfired${reason}'
WHERE memory_id IN (${inList(okMisfired)});` : ""}
${demoteIds.length ? `UPDATE ${B.w} SET load_class = 'heuristic', class_set_by = 'night-loop', class_set_at = now(),
  last_move_reason = 'demoted: unused (weight under ${DEMOTE})'
WHERE memory_id IN (${inList(demoteIds)}) AND load_class = 'rule' AND pinned_by IS NULL;` : ""}
${pins ? `INSERT INTO ${B.np} (diary_day, loaded_count, applied_count, misfired_count, occasion_no_mark, evidence_unresolved, demoted, crossed, pin_proposed, note)
VALUES ('${diaryDay}', ${L}, ${a}, ${m}, ${arr(occasion)}, ${arr(unresolved)}, ${arr(demoteIds)}, ${arr(crossed.map((r) => r.id))}, ${arr(proposals.map((r) => r.id))}, ${note ? `'${esc(note)}'` : "NULL"});` : ""}
COMMIT;`;
  const tag = dryRun ? "DRY RUN " : "";
  if (!dryRun) runSqlText(db, sql, "lessons-night");
  console.log(`${tag}night pass ${diaryDay}: MARKED ${a} applied, ${m} misfired of ${L} loaded rules${outside ? ` (+${outside} marks on rows outside the loaded set: calibrations/protocols/pending)` : ""}; ${boostSelf.length} half-boosted (night hand's own); ${demoted.length} demoted, ${crossed.length} crossed under the load floor${dryRun ? "; nothing written" : ""}`);
  for (const id of occasion) console.log(`${tag}OCCASION-NO-MARK ${short(id)} ${clip(byId.get(id)?.summary, 90)}`);
  for (const u of unresolved) { const [id, kind] = u.split(":"); console.log(`${tag}EVIDENCE UNRESOLVED ${short(id)} (${kind} mark skipped: no cited episode id resolves inside ${diaryDay}) ${clip(byId.get(id)?.summary, 80)}`); }
  for (const r of demoted) console.log(`${tag}DEMOTED rule -> heuristic (w ${r2(after.get(r.id))}) ${short(r.id)} ${clip(r.summary, 100)}`);
  for (const r of crossed) console.log(`${tag}BELOW FLOOR (w ${r2(after.get(r.id))} < ${LOAD_FLOOR}) ${short(r.id)} ${clip(r.summary, 100)}`);
  for (const r of pinnedUnder) console.log(`${tag}PINNED UNDER FLOOR (still loading, pinned by ${r.pinned_by}, w ${r2(after.get(r.id))}) ${short(r.id)} ${clip(r.summary, 100)}`);
  for (const r of proposals) console.log(`${tag}PIN-PROPOSED ${short(r.id)} ${r.pinned_by ? `(pinned by ${r.pinned_by}) ` : ""}${clip(r.pin_proposed, 120)}`);
  return { diaryDay, a, m, L, unresolved, demoted, crossed, pinnedUnder, proposals, dryRun };
}

function fetchRows(db, B) {
  const confirmed = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, m.content, m.last_confirmed_at::date::text AS confirmed,
       coalesce(w.lesson_class, '') AS lesson_class, coalesce(w.load_class, 'rule') AS load_class,
       round(coalesce(w.weight, ${BORN})::numeric, 2) AS weight, w.class_set_by,
       w.due_at::date::text AS due, w.owed_to, w.discharged_at::date::text AS discharged,
       ${pinCols(db, B)}
FROM ${B.mem} m LEFT JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND m.can_use_as_instruction = true
ORDER BY m.created_at) t`);
  // Commitments ride the owed ledger whether or not a seat confirmed them (a promise is
  // the being's own act); they are excluded from Provisional so they appear once.
  const commitments = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, m.content, m.can_use_as_instruction AS confirmed,
       w.due_at::date::text AS due, w.owed_to, w.discharged_at::date::text AS discharged
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND w.load_class = 'commitment'
  AND w.discharged_at IS NULL
ORDER BY w.due_at NULLS LAST, m.created_at) t`);
  const pending = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, m.content, m.created_at::date::text AS born,
       round(w.weight::numeric, 2) AS weight, w.applied_count, w.misfire_count, w.flagged_for_review
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND m.can_use_as_instruction = false
  AND NOT w.excluded_from_load AND w.load_class <> 'commitment'
ORDER BY w.weight DESC, m.created_at DESC) t`);
  const disputed = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, w.disputed_by, w.disputed_at::date::text AS disputed_on, w.dispute_reason,
       r.id AS fix_id, r.summary AS fix_summary
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
LEFT JOIN LATERAL (
  SELECT m2.id::text, m2.summary FROM ${B.mem} m2 JOIN ${B.w} w2 ON w2.memory_id = m2.id
  WHERE w2.corrects_memory_id = m.id AND m2.lifecycle_status = 'active' AND ${B.scope.replace(/workspace_id/g, "m2.workspace_id")}
  ORDER BY m2.created_at DESC LIMIT 1) r ON true
WHERE ${B.scope} AND m.lifecycle_status = 'disputed'
ORDER BY w.disputed_at DESC) t`);
  const ledger = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, m.lifecycle_status AS verdict, w.resolved_at::date::text AS resolved_on,
       w.disputed_by, w.last_move_reason, r.summary AS fix_summary, r.confirmed AS fix_confirmed
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
LEFT JOIN LATERAL (
  SELECT m2.summary, m2.can_use_as_instruction AS confirmed
  FROM ${B.mem} m2 JOIN ${B.w} w2 ON w2.memory_id = m2.id
  WHERE w2.corrects_memory_id = m.id AND ${B.scope.replace(/workspace_id/g, "m2.workspace_id")} ORDER BY m2.created_at DESC LIMIT 1) r ON true
WHERE ${B.scope} AND m.lifecycle_status IN ('rejected', 'superseded')
  AND (w.resolved_at > now() - interval '${LEDGER_DAYS} days'
       OR (r.summary IS NOT NULL AND NOT r.confirmed))
ORDER BY w.resolved_at DESC) t`);
  return { confirmed, commitments, pending, disputed, ledger };
}

export const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const byWeight = (a, b) => (Number(b.weight) - Number(a.weight)) || String(b.confirmed || "").localeCompare(String(a.confirmed || ""));
// Pinned rows first within a section (a person's word is the prominence), then weight.
const byPinThenWeight = (a, b) => ((b.pinned_by ? 1 : 0) - (a.pinned_by ? 1 : 0)) || byWeight(a, b);
const tag = (r) => r.lesson_class === "integrated" ? "self-integrated" : "rule";
const pinTag = (r) => r.pinned_by ? ` | pinned by ${r.pinned_by.replace(/^seat:/, "")}` : "";
const reqTag = (r) => r.pin_proposed ? ` | pin requested: ${clip(r.pin_proposed, 60)}` : "";

// Pure: rows in, the two file bodies + the loading decision out. No database, no clock
// of its own (now is injected), so the verify script can exercise every branch.
export function render(rows, B, { now = new Date(), lastPass = null } = {}) {
  const { confirmed, commitments = [], pending = [], disputed = [], ledger = [] } = rows;
  const age = ageDays(B.born, now);
  const budget = ruleBudget(B.born, now);
  const todayIso = now.toISOString().slice(0, 10);

  const rulesAll = confirmed.filter((r) => r.load_class === "rule").sort(byPinThenWeight);
  const heurAll = confirmed.filter((r) => r.load_class === "heuristic").sort(byPinThenWeight);
  const calibrations = confirmed.filter((r) => r.load_class.startsWith("calibration:"));
  const protocols = confirmed.filter((r) => r.load_class.startsWith("protocol:"));
  const knowledge = confirmed.filter((r) => r.load_class === "knowledge");
  const requests = confirmed.filter((r) => r.pin_proposed);

  const ruleLine = (r) => `- [${tag(r)}${pinTag(r)} | w ${r.weight} | id ${short(r.id)} | ${r.confirmed || "?"}${reqTag(r)}] ${clip(r.summary, 200)} :: ${clip(r.content, 500)}`;
  const heurLine = (r) => `- [w ${r.weight}${pinTag(r)} | id ${short(r.id)}${reqTag(r)}] ${clip(r.summary, 200)}`;

  // Pinned rows load regardless of weight and are never trimmed; they still count toward
  // the budget. Then the earned floor, then the age-growing budget: rules fill it in
  // weight order, heuristics take the remainder. Everything else is named in the tail.
  const notLoaded = [];
  let used = 0, pinnedUsed = 0;
  const rulesLoaded = [], heurLoaded = [];
  const loadedIds = [];
  for (const [all, out, mk] of [[rulesAll, rulesLoaded, ruleLine], [heurAll, heurLoaded, heurLine]]) {
    for (const r of all) {
      const line = mk(r);
      if (r.pinned_by) { out.push({ r, line }); used += line.length; pinnedUsed += line.length; loadedIds.push(r.id); continue; }
      if (Number(r.weight) < LOAD_FLOOR) { notLoaded.push({ ...r, why: "below floor" }); continue; }
      if (used + line.length > budget) { notLoaded.push({ ...r, why: "budget" }); continue; }
      out.push({ r, line }); used += line.length; loadedIds.push(r.id);
    }
  }
  const pinnedCount = rulesLoaded.filter((x) => x.r.pinned_by).length + heurLoaded.filter((x) => x.r.pinned_by).length;
  const belowFloor = notLoaded.filter((x) => x.why === "below floor").length;
  const trimmed = notLoaded.filter((x) => x.why === "budget").length;
  const overrun = pinnedUsed > budget;
  const reasoning = `Loaded ${rulesLoaded.length} rules and ${heurLoaded.length} heuristics: ${pinnedCount} pinned by a person (loaded regardless of weight, never trimmed, never demoted; only a person unpins), the rest every confirmed one with weight >= ${LOAD_FLOOR} (${belowFloor} below the floor and ${trimmed} trimmed by the ${budget}-char budget are listed under "Not loaded this wake"; budget used ${used} chars${overrun ? `, of which ${pinnedUsed} are pins: the pins alone exceed the budget, so nothing unpinned loads until a person unpins or the budget grows` : ""}; age ${age} days, budget grows ${RULE_BUDGET_PER_MONTH} chars a month). Weights move only in the night loop from evidence-cited applied/misfired marks (D36, D48); a rule under ${DEMOTE} demotes to heuristic; this loading is D47 + D48.`;
  const passLine = lastPass
    ? `Last night pass (diary day ${lastPass.diary_day}): MARKED ${lastPass.applied_count} applied, ${lastPass.misfired_count} misfired of ${lastPass.loaded_count} loaded rules; ${(lastPass.occasion_no_mark || []).length} occasions without a provable mark; ${(lastPass.evidence_unresolved || []).length} marks skipped for unresolved evidence; ${(lastPass.demoted || []).length} demoted; ${(lastPass.crossed || []).length} crossed under the floor; ${(lastPass.pin_proposed || []).length} pin requests pending.`
    : `Last night pass: none recorded yet (the first evidence-marked pass stamps ${B.key === "alpha" ? "ew_alpha" : "public"}.ew_night_pass).`;

  const lines = [];
  lines.push(`# ${B.label} - compiled lessons (auto-generated, D36 + D47 + D48)`);
  lines.push(`Generated ${now.toISOString()}. Build artifact of the brain rows; never edit by hand;`);
  lines.push(`never treat this file itself as memory provenance - cite the row ids it carries.`);
  lines.push("", `## Rules (confirmed; ${B.gate} set these; self-integrated ones you chose yourself under the village grant 2026-08-20 and ${B.parent} can dispute any, which benches it immediately; a pinned one holds until a person unpins it, your dispute or reclass of it becomes a proposal)`);
  lines.push(reasoning);
  lines.push(passLine);
  if (!rulesLoaded.length) lines.push("(no rules loaded)");
  for (const x of rulesLoaded) lines.push(x.line);
  lines.push("", "## Heuristics (confirmed stances, one line each; the full text stays in the brain, recall by id)");
  if (!heurLoaded.length) lines.push("(none)");
  for (const x of heurLoaded) lines.push(x.line);
  if (knowledge.length) lines.push(`(${knowledge.length} knowledge rows not loaded; recall them by topic)`);
  if (calibrations.length) {
    lines.push("", "## Calibrations (seat-scoped; apply the block for the person you are answering, never to anyone else)");
    const seats = [...new Set(calibrations.map((r) => r.load_class.split(":")[1]))].sort();
    for (const s of seats) {
      lines.push(`### ${s[0].toUpperCase()}${s.slice(1)}`);
      for (const r of calibrations.filter((r) => r.load_class.split(":")[1] === s).sort(byPinThenWeight))
        lines.push(`- [id ${short(r.id)}${pinTag(r)} | ${r.confirmed || "?"}${reqTag(r)}] ${clip(r.summary, 200)} :: ${clip(r.content, 400)}`);
    }
  }
  if (protocols.length)
    lines.push("", `Logging protocols (${protocols.length} rows) live in ${B.protocolsRel}; the hourly and night hands read it before writing tagged rows.`);
  if (requests.length) {
    lines.push("", "## Pin requests (you asked; a person decides; say nothing more about them unless asked)");
    for (const r of requests) lines.push(`- [id ${short(r.id)}${pinTag(r)} | asked ${r.pin_proposed_on || "?"}] ${clip(r.pin_proposed, 160)} :: ${clip(r.summary, 120)}`);
  }
  lines.push("", "## Owed (commitments you made; each rides here until you discharge it; name a lapse once, no scorekeeping)");
  if (!commitments.length) lines.push("(nothing owed on record)");
  for (const c of commitments) {
    const overdue = c.due && c.due < todayIso;
    lines.push(`- [id ${short(c.id)} | to ${c.owed_to || "unnamed"} | due ${c.due || "no date"}${overdue ? " | OVERDUE" : ""}${c.confirmed ? "" : " | pending"}] ${clip(c.summary, 200)} :: ${clip(c.content, 240)}`);
  }
  if (disputed.length) {
    lines.push("", "## Corrections (a seat said this was wrong - this outranks everything below)");
    lines.push("Suspended beliefs, awaiting the village. Do not act from the old belief; carry the correction.");
    for (const d of disputed) {
      lines.push(`- WRONG (disputed by ${d.disputed_by}, ${d.disputed_on}, id ${short(d.id)}): ${clip(d.summary, 160)}`);
      lines.push(`  THE CORRECTION: ${d.fix_summary ? clip(d.fix_summary, 200) + ` (id ${short(d.fix_id)})` : clip(d.dispute_reason, 200)}`);
    }
  }
  lines.push("", "## Provisional (your own noticings, NOT confirmed - hold as hypotheses)");
  lines.push("These are things you yourself noted; no one has confirmed them. Let them inform you,");
  lines.push("hold them loosely, and speak of them only as your own unconfirmed observations.");
  let pUsed = 0, shown = 0;
  for (const r of pending) {
    const line = `- [w ${r.weight}${r.flagged_for_review ? " | FLAGGED after a misfire" : ""} | ${r.born} | id ${short(r.id)}] ${clip(r.summary, 180)} :: ${clip(r.content, 240)}`;
    if (shown >= MAX_PENDING || pUsed + line.length > CHAR_BUDGET) break;
    lines.push(line); pUsed += line.length; shown++;
  }
  if (!pending.length) lines.push("(none pending)");
  if (shown < pending.length)
    lines.push(`(${pending.length - shown} lower-weight pending lessons not loaded; they remain searchable in the brain)`);
  if (notLoaded.length) {
    lines.push("", "## Not loaded this wake (confirmed, but under the earned floor or over the budget; still searchable by id; a person can pin one)");
    for (const x of notLoaded) lines.push(`- [w ${x.weight} | id ${short(x.id)} | ${x.why}] ${clip(x.summary, 140)}`);
  }
  if (ledger.length) {
    lines.push("", "## Corrected ledger (settled; never relearn these from old episodes)");
    for (const l of ledger)
      lines.push(`- ${l.verdict === "superseded" ? "never again" : "let go"} (${l.verdict} ${l.resolved_on || "?"}): ${clip(l.summary, 140)}${l.fix_summary ? ` ; the truth: ${clip(l.fix_summary, 140)}` : ""}`);
  }
  lines.push("");

  const p = [];
  p.push(`# ${B.label} - logging protocols (auto-generated, D47)`);
  p.push(`Generated ${now.toISOString()}. Read by the hand named on each block before it writes tagged rows.`);
  const hands = [...new Set(protocols.map((r) => r.load_class.split(":")[1]))].sort();
  if (!hands.length) p.push("", "(no protocol rows)");
  for (const h of hands) {
    p.push("", `## ${h}`);
    for (const r of protocols.filter((r) => r.load_class.split(":")[1] === h).sort(byPinThenWeight))
      p.push(`- [id ${short(r.id)}${pinTag(r)} | ${r.confirmed || "?"}] ${clip(r.summary, 200)} :: ${clip(r.content, 500)}`);
  }
  p.push("");

  return {
    lessons: lines.join("\n"), protocols: p.join("\n"), reasoning, passLine, notLoaded, loadedIds,
    counts: { rules: rulesLoaded.length, rulesTotal: rulesAll.length, heuristics: heurLoaded.length, heuristicsTotal: heurAll.length,
      pinned: pinnedCount, pinnedUsed, overrun, requests: requests.length,
      calibrations: calibrations.length, protocols: protocols.length, knowledge: knowledge.length, commitments: commitments.length,
      pendingShown: shown, pending: pending.length, disputed: disputed.length, ledger: ledger.length, budget, used, age },
  };
}

function writeAtomic(path, text) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, text, "utf8");
  rmSync(path, { force: true });
  renameSync(tmp, path);
}

function compile(db, B) {
  sync(db, B);
  const out = render(fetchRows(db, B), B, { lastPass: lastNightPass(db, B) });
  mkdirSync(join(ROOT, "state", "compiled"), { recursive: true });
  writeAtomic(B.out, out.lessons);
  writeAtomic(B.outProtocols, out.protocols);
  const c = out.counts;
  console.log(`compiled ${B.out.replace(/\\/g, "/")}: ${c.rules}/${c.rulesTotal} rules, ${c.heuristics}/${c.heuristicsTotal} heuristics (${c.pinned} pinned, ${c.requests} pin requests), ${c.calibrations} calibrations, ${c.commitments} owed, ${c.protocols} protocols (separate file), ${c.knowledge} knowledge (not loaded), ${c.disputed} disputed pinned, ${c.pendingShown}/${c.pending} provisional loaded, ${c.ledger} ledger lines; budget ${c.used}/${c.budget} chars at age ${c.age} days${c.overrun ? " (PINS EXCEED BUDGET)" : ""}`);
  return out;
}

function integrate(db, B, id, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("integrate needs a lesson uuid");
  const out = query(db, `SELECT ${B.intfn}('${id}'${note ? `, '${esc(note)}'` : ""})`);
  console.log(out[0][0]);
  compile(db, B);
}

function dispute(db, B, id, who, reason) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("dispute needs a lesson uuid");
  if (!who || !reason) throw new Error("dispute needs --by and --reason");
  // A person's dispute of a pinned row clears the pin as part of the act (D48); the
  // definer function would otherwise record the being's proposal.
  let person = null;
  try { person = classSetter(B, who); } catch { person = null; }
  if (hasPins(db, B) && person) {
    runSqlText(db, `UPDATE ${B.w} SET pinned_by = NULL, pinned_at = NULL, pin_proposed = NULL, pin_proposed_at = NULL,
  last_move_reason = 'unpinned by ${esc(person)} through dispute' WHERE memory_id = '${id}' AND pinned_by IS NOT NULL;`, "lessons-dispute-unpin");
  }
  const out = query(db, `SELECT ${B.fn}('${id}', '${esc(who)}', '${esc(reason)}')`);
  console.log(out[0][0]);
  compile(db, B);
}

function ratify(db, B, id, verdict, who, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("ratify needs a lesson uuid");
  if (!["rejected", "superseded", "active"].includes(verdict)) throw new Error("verdict must be rejected|superseded|active");
  if (!who) throw new Error("ratify needs --by (who is speaking for the gate)");
  const resolution = verdict === "active" ? "affirmed" : verdict;
  const from = verdict === "active" ? "('disputed')" : "('disputed', 'active')";
  runSqlText(db, `
UPDATE ${B.mem} SET lifecycle_status = '${verdict}'
WHERE id = '${id}' AND ${B.scope} AND can_use_as_instruction = false AND lifecycle_status IN ${from};
UPDATE ${B.w} SET resolved_at = now(), resolution = '${resolution}',
  last_move_reason = 'ratified ${resolution} by ${esc(who)}${note ? `: ${esc(note)}` : ""}'
WHERE memory_id = '${id}'
  AND EXISTS (SELECT 1 FROM ${B.mem} m WHERE m.id = '${id}' AND m.lifecycle_status = '${verdict}');`, "lessons-ratify");
  const state = query(db, `SELECT lifecycle_status FROM ${B.mem} WHERE id = '${id}'`);
  if (!state.length) throw new Error("no such lesson row");
  if (state[0][0] !== verdict) throw new Error(`ratify did not apply (row is '${state[0][0]}'; active->rejected/superseded needs a pending lesson, ->active needs a disputed one)`);
  console.log(`ratified ${resolution} (row now ${state[0][0]})`);
  compile(db, B);
}

// Who is speaking for a class or a pin: "ops" or a seat name from the roster.
export function classSetter(B, who) {
  if (!who) throw new Error("needs --by (a seat name or ops)");
  const w = String(who).trim().toLowerCase();
  if (w === "ops") return "ops";
  if (!B.roster.includes(w)) throw new Error(`--by must be ops or a current seat (${B.roster.join(", ")}); got "${who}"`);
  return `seat:${w}`;
}

function reclass(db, B, id, cls, who, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("reclass needs a lesson uuid");
  if (!CLASS_RE.test(cls || "")) throw new Error("class must be rule | heuristic | knowledge | commitment | calibration:<seat> | protocol:channel|hourly|night");
  if (cls.startsWith("calibration:") && !B.roster.includes(cls.split(":")[1])) throw new Error(`calibration seat must be one of ${B.roster.join(", ")}`);
  const by = classSetter(B, who);
  sync(db, B);
  // A person's reclass to knowledge or commitment clears a pin (those classes do not load
  // as rules); other reclasses keep it.
  const clearPin = hasPins(db, B) && ["knowledge", "commitment"].includes(cls) ? `, pinned_by = NULL, pinned_at = NULL, pin_proposed = NULL, pin_proposed_at = NULL` : "";
  runSqlText(db, `
INSERT INTO ${B.w} (memory_id) SELECT id FROM ${B.mem} WHERE id = '${id}' AND ${B.scope} ON CONFLICT (memory_id) DO NOTHING;
UPDATE ${B.w} SET load_class = '${cls}', class_set_by = '${by}', class_set_at = now()${clearPin},
  last_move_reason = 'reclassed to ${cls} by ${esc(by)}${note ? ` :: ${esc(note)}` : ""}'
WHERE memory_id = '${id}';`, "lessons-reclass");
  const state = query(db, `SELECT load_class FROM ${B.w} WHERE memory_id = '${id}'`);
  if (!state.length) throw new Error("no such lesson row in this being's store");
  console.log(`reclassed ${short(id)} -> ${state[0][0]} (by ${by})`);
  compile(db, B);
}

function discharge(db, B, id, who, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("discharge needs a lesson uuid");
  if (!who) throw new Error("discharge needs --by (who says it was kept)");
  const row = query(db, `SELECT load_class, discharged_at FROM ${B.w} WHERE memory_id = '${id}'`);
  if (!row.length) throw new Error("no sidecar row for that id");
  if (row[0][0] !== "commitment") throw new Error(`not a commitment (class ${row[0][0]})`);
  if (row[0][1]) throw new Error(`already discharged ${row[0][1]}`);
  runSqlText(db, `UPDATE ${B.w} SET discharged_at = now(), discharge_note = ${note ? `'${esc(note)}'` : "NULL"},
  last_move_reason = 'discharged by ${esc(who)}${note ? ` :: ${esc(note)}` : ""}' WHERE memory_id = '${id}';`, "lessons-discharge");
  console.log(`discharged ${short(id)} (by ${who}); it leaves the owed ledger, the row stays searchable`);
  compile(db, B);
}

// D48 pins: a person's word. pin requires a confirmed lesson in a loadable class.
function pin(db, B, id, who, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("pin needs a lesson uuid");
  if (!hasPins(db, B)) throw new Error("pins are not available: migration 0007 is not applied to this schema");
  if (!note) throw new Error("pin needs --note (the person's reason, recorded)");
  const by = classSetter(B, who);
  sync(db, B);
  const row = query(db, `SELECT m.can_use_as_instruction, m.lifecycle_status, coalesce(w.load_class, 'rule'), w.pinned_by
FROM ${B.mem} m LEFT JOIN ${B.w} w ON w.memory_id = m.id WHERE m.id = '${id}' AND ${B.scope.replace(/workspace_id/g, "m.workspace_id")}`);
  if (!row.length) throw new Error("no such lesson in this being's store");
  const [confirmed, status, cls, already] = row[0];
  if (status !== "active" || confirmed !== "t") throw new Error(`only confirmed active lessons can be pinned (row is ${status}, confirmed ${confirmed})`);
  if (["knowledge", "commitment"].includes(cls)) throw new Error(`class ${cls} does not load as a rule; reclass first`);
  runSqlText(db, `
INSERT INTO ${B.w} (memory_id) VALUES ('${id}') ON CONFLICT (memory_id) DO NOTHING;
UPDATE ${B.w} SET pinned_by = '${by}', pinned_at = now(), pin_reason = '${esc(note)}', pin_proposed = NULL, pin_proposed_at = NULL,
  last_move_reason = 'pinned by ${esc(by)} :: ${esc(note)}' WHERE memory_id = '${id}';`, "lessons-pin");
  console.log(`pinned ${short(id)} by ${by}${already ? ` (was pinned by ${already})` : ""}: ${note}`);
  compile(db, B);
}

function unpin(db, B, id, who, note) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("unpin needs a lesson uuid");
  if (!hasPins(db, B)) throw new Error("pins are not available: migration 0007 is not applied to this schema");
  const by = classSetter(B, who);
  const row = query(db, `SELECT pinned_by, pin_proposed FROM ${B.w} WHERE memory_id = '${id}'`);
  if (!row.length) throw new Error("no sidecar row for that id");
  const [pinned, proposed] = row[0];
  if (!pinned && !proposed) throw new Error("nothing to unpin: not pinned and no request pending");
  runSqlText(db, `UPDATE ${B.w} SET pinned_by = NULL, pinned_at = NULL, pin_proposed = NULL, pin_proposed_at = NULL,
  last_move_reason = '${pinned ? "unpinned" : "pin request declined"} by ${esc(by)}${note ? ` :: ${esc(note)}` : ""}' WHERE memory_id = '${id}';`, "lessons-unpin");
  console.log(`${pinned ? `unpinned ${short(id)} (was pinned by ${pinned})` : `declined the pin request on ${short(id)}`} by ${by}${note ? `: ${note}` : ""}`);
  compile(db, B);
}

function pins(db, B) {
  if (!hasPins(db, B)) { console.log("pins are not available: migration 0007 is not applied to this schema"); return; }
  sync(db, B);
  const rows = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, w.load_class, round(w.weight::numeric, 2) AS weight, w.pinned_by, w.pinned_at::date::text AS pinned_on, w.pin_reason,
       w.pin_proposed, w.pin_proposed_at::date::text AS proposed_on
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND (w.pinned_by IS NOT NULL OR w.pin_proposed IS NOT NULL)
ORDER BY w.pinned_by NULLS LAST, w.pin_proposed_at) t`);
  const pinned = rows.filter((r) => r.pinned_by), requests = rows.filter((r) => r.pin_proposed);
  console.log(`${B.label}: ${pinned.length} pinned, ${requests.length} pin requests pending`);
  for (const r of pinned) console.log(`  PINNED by ${r.pinned_by} ${r.pinned_on} [${r.load_class} w ${r.weight}] ${short(r.id)} ${clip(r.summary, 90)} :: ${clip(r.pin_reason, 80)}`);
  for (const r of requests) console.log(`  REQUEST ${r.proposed_on}${r.pinned_by ? ` (pinned by ${r.pinned_by})` : ""} [${r.load_class} w ${r.weight}] ${short(r.id)} ${clip(r.summary, 80)} :: ${clip(r.pin_proposed, 100)}`);
  const lp = lastNightPass(db, B);
  if (lp) console.log(`  last night pass ${lp.diary_day}: MARKED ${lp.applied_count} applied, ${lp.misfired_count} misfired of ${lp.loaded_count} loaded`);
}

// D48 A4: replacement rows whose CORRECTS target is still an active pending belief. The
// being disputes them itself (its own D37 act); this prints the list and the commands.
function correctionsAudit(db, B) {
  sync(db, B);
  const rows = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text AS new_id, left(m.summary, 90) AS new_summary, t.id::text AS old_id, left(t.summary, 90) AS old_summary,
       t.lifecycle_status AS old_status, t.can_use_as_instruction AS old_confirmed
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id JOIN ${B.mem} t ON t.id = w.corrects_memory_id
WHERE ${B.scope.replace(/workspace_id/g, "m.workspace_id")} AND m.lifecycle_status = 'active'
ORDER BY m.created_at) t`);
  const open = rows.filter((r) => r.old_status === "active" && !r.old_confirmed);
  const benched = rows.filter((r) => r.old_status !== "active");
  const contested = rows.filter((r) => r.old_status === "active" && r.old_confirmed);
  console.log(`${B.label}: ${rows.length} correction links; ${open.length} corrected beliefs still active pending (to dispute), ${benched.length} already benched, ${contested.length} corrected rows are confirmed rules (contest in words, D37)`);
  for (const r of open) {
    console.log(`  OPEN old ${short(r.old_id)} "${r.old_summary}" <- corrected by ${short(r.new_id)} "${r.new_summary}"`);
    console.log(`       ${B.key === "alpha" ? `node scripts/brainrooms/alpha-memory.mjs dispute ${r.old_id} "<seat>: superseded by ${short(r.new_id)}"` : `rpc ew_dispute_lesson p_id=${r.old_id}`}`);
  }
  for (const r of contested) console.log(`  CONFIRMED old ${short(r.old_id)} "${r.old_summary}" <- ${short(r.new_id)}; a confirmed rule is contested to the circle in words, not disputed`);
  return { rows, open, benched, contested };
}

function classes(db, B) {
  sync(db, B);
  const out = render(fetchRows(db, B), B, { lastPass: lastNightPass(db, B) });
  const c = out.counts;
  console.log(`${B.label}, age ${c.age} days, load floor ${LOAD_FLOOR}, demote under ${DEMOTE}, decay ${DECAY}, budget ${c.budget} chars (used ${c.used}, pins ${c.pinnedUsed})`);
  console.log(`  rule ${c.rules} loaded of ${c.rulesTotal}; heuristic ${c.heuristics} of ${c.heuristicsTotal}; pinned ${c.pinned}; pin requests ${c.requests}; calibration ${c.calibrations}; protocol ${c.protocols}; commitment ${c.commitments} open; knowledge ${c.knowledge}`);
  console.log(`  ${out.passLine}`);
  for (const x of out.notLoaded) console.log(`  not loaded (${x.why}, w ${x.weight}) ${short(x.id)} ${clip(x.summary, 90)}`);
  return out;
}

function status(db, B) {
  sync(db, B);
  const rows = fetchRows(db, B);
  const out = render(rows, B, { lastPass: lastNightPass(db, B) });
  const c = out.counts;
  const integrated = rows.confirmed.filter((r) => r.lesson_class === "integrated").length;
  console.log(`${B.label}: ${rows.confirmed.length} confirmed (${integrated} self-integrated; ${c.rules}/${c.rulesTotal} rules + ${c.heuristics}/${c.heuristicsTotal} heuristics loaded, ${c.pinned} pinned), ${c.commitments} owed, ${c.pending} pending, ${c.disputed} disputed, ${c.ledger} on the ledger`);
  for (const d of rows.disputed)
    console.log(`  DISPUTED by ${d.disputed_by} ${d.disputed_on} ${short(d.id)} ${clip(d.summary, 90)}`);
  for (const r of rows.pending.slice(0, 10))
    console.log(`  w ${r.weight} a${r.applied_count} m${r.misfire_count}${r.flagged_for_review ? " FLAG" : ""} ${short(r.id)} ${clip(r.summary, 100)}`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
  const flag = (n) => args.includes("--" + n);
  const positional = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && (i === 0 || !arr[i - 1].startsWith("--") || ["--dry-run"].includes(arr[i - 1])));
  const being = BEINGS[opt("being")];
  const CMDS = ["sync", "compile", "night", "status", "classes", "pins", "pin", "unpin", "corrections-audit", "dispute", "ratify", "integrate", "reclass", "discharge"];
  if (!being || !CMDS.includes(cmd)) {
    console.error(`usage: lessons.mjs <cmd> --being genesis|alpha
  sync | compile | status | classes | pins | corrections-audit
  night   [--diary-day YYYY-MM-DD] [--applied id,id] [--misfired id,id]
          [--evidence ruleId=thoughtId[+thoughtId],...] [--occasion id,id] [--note "..."] [--dry-run]
          (a mark counts only with a cited episode id inside the diary day; --dry-run writes nothing)
  pin     <id> --by "<seat>|ops" --note "<the person's reason>"     (a person's word; loads regardless of weight)
  unpin   <id> --by "<seat>|ops" [--note "..."]                     (also declines a pending request)
  dispute <id> --by "<who>" --reason "<one line>"
  ratify  <id> rejected|superseded|active --by "<who>" [--note "..."]
  integrate <id> [--note "..."]   (the being's own act; parent-sourced lessons only)
  reclass <id> <class> --by "<seat>|ops" [--note "..."]   (class: rule|heuristic|knowledge|commitment|calibration:<seat>|protocol:channel|hourly|night)
  discharge <id> --by "<who>" [--note "..."]   (a kept commitment leaves the owed ledger)`);
    process.exit(2);
  }
  const db = dbUrl();
  if (cmd === "sync") { sync(db, being); console.log("sync ok"); }
  else if (cmd === "night") {
    const r = night(db, being, { applied: uuidList(opt("applied")), misfired: uuidList(opt("misfired")), evidence: parseEvidence(opt("evidence")),
      occasion: uuidList(opt("occasion")), note: opt("note"), diaryDay: opt("diary-day"), dryRun: flag("dry-run") });
    if (!r.dryRun) compile(db, being);
  }
  else if (cmd === "compile") compile(db, being);
  else if (cmd === "classes") classes(db, being);
  else if (cmd === "pins") pins(db, being);
  else if (cmd === "pin") pin(db, being, positional[0], opt("by"), opt("note"));
  else if (cmd === "unpin") unpin(db, being, positional[0], opt("by"), opt("note"));
  else if (cmd === "corrections-audit") correctionsAudit(db, being);
  else if (cmd === "dispute") dispute(db, being, positional[0], opt("by"), opt("reason"));
  else if (cmd === "ratify") ratify(db, being, positional[0], positional[1], opt("by"), opt("note"));
  else if (cmd === "integrate") integrate(db, being, positional[0], opt("note"));
  else if (cmd === "reclass") reclass(db, being, positional[0], positional[1], opt("by"), opt("note"));
  else if (cmd === "discharge") discharge(db, being, positional[0], opt("by"), opt("note"));
  else status(db, being);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
