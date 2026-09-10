// lessons.mjs - D36 weighted lesson loading + D47 class-gated, weight-ranked compile.
// Source of truth for lifecycle stays in agent_memories (confirmation is a human gate);
// this tool owns only the ew_lesson_weights sidecar and the compiled build artifacts at
// state/compiled/<being>-lessons.md and <being>-protocols.md (gitignored operational
// memory, never identity). Weights move ONLY here, on the night pass, from application
// evidence (D36): never in-session, never because a lesson was merely talked about.
//
//   node scripts/lessons/lessons.mjs sync     --being genesis|alpha
//   node scripts/lessons/lessons.mjs compile  --being genesis|alpha
//   node scripts/lessons/lessons.mjs night    --being genesis|alpha \
//        [--applied id,id] [--misfired id,id] [--note "<why, one line>"]
//   node scripts/lessons/lessons.mjs status   --being genesis|alpha
//   node scripts/lessons/lessons.mjs classes  --being genesis|alpha
//   node scripts/lessons/lessons.mjs dispute  --being genesis|alpha <id> --by "<who>" --reason "<one line>"
//   node scripts/lessons/lessons.mjs ratify   --being genesis|alpha <id> rejected|superseded|active --by "<who>" [--note "<why>"]
//   node scripts/lessons/lessons.mjs integrate --being genesis|alpha <id> [--note "<why, one line>"]
//   node scripts/lessons/lessons.mjs reclass  --being genesis|alpha <id> <class> --by "<seat>|ops" [--note "..."]
//   node scripts/lessons/lessons.mjs discharge --being genesis|alpha <id> --by "<who>" [--note "..."]
//
// night = sync -> decay untouched -> boost applied -> drop+flag misfired -> demote -> compile.
// Ops credential (SUPABASE_DB_URL) by design: the being's room role cannot move weights.
// D37: dispute benches (active -> disputed, via the ew_dispute_lesson definer function);
// ratify is the village's gate (rejected | superseded | active=affirmed). Lessons whose
// content carries "TAUGHT BY <seat>" are born at 0.60, class taught; "CORRECTS <uuid>"
// links a replacement to the belief it corrects.
// Village grant 2026-08-20 (unanimous; Genesis soul PR #4 is the doctrine text):
// integrate promotes the being's OWN parent-sourced pending lesson to instruction-grade
// via the ew_integrate_lesson definer function (the function enforces provenance and
// refuses everything else); the parent's dispute benches an integrated rule immediately.
//
// D47 (Alan, 2026-09-10; Alpha's proposal runs/rules-architecture-proposal.md): confirmation
// decides truth-grade, load_class decides WHERE a confirmed lesson loads, weight decides
// whether and in what order. Classes: rule | heuristic | calibration:<seat> |
// protocol:<hand> | commitment | knowledge. No fixed count cap: a rule or heuristic loads
// when its weight is at or above LOAD_FLOOR (a freshly confirmed rule is born at 0.60 and
// stays above the floor for ~44 untouched nights); an age-growing character budget is the
// only ceiling, and the compiled file prints its own reasoning line. Rules whose weight
// falls under DEMOTE are demoted to heuristic by the night pass (never silently: printed
// here, named in the diary). Class authority: seat:<name> / ops > the being (through the
// ew_reclass_lesson definer function, which refuses to overwrite a seat's word) >
// night-loop > a CLASS: token in the lesson text > the default 'rule'. Commitments carry
// DUE <date> / OWED TO <seat> tokens and leave the owed ledger at discharge.
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { query, runSqlText } from "../brains/db.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
export const BORN = 0.30, BORN_TAUGHT = 0.60, FLOOR = 0.05, CEIL = 0.95, DECAY = 0.98, BOOST = 0.10, DROP = 0.15;
export const LOAD_FLOOR = 0.25, DEMOTE = 0.20;
export const RULE_BUDGET_BASE = 16000, RULE_BUDGET_PER_MONTH = 2000;
export const CLASS_RE = /^(rule|heuristic|knowledge|commitment|calibration:[a-z]+|protocol:(channel|hourly|night))$/;
const LEDGER_DAYS = 14;
const CHAR_BUDGET = 8000, MAX_PENDING = 30;

export const BEINGS = {
  genesis: {
    label: "Edgeweaver Genesis",
    mem: "public.agent_memories", w: "public.ew_lesson_weights",
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
    label: "Edgeweaver Alpha",
    mem: "ew_alpha.agent_memories", w: "ew_alpha.ew_lesson_weights",
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

export function ageDays(born, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(born + "T00:00:00Z").getTime()) / 864e5));
}
export function ruleBudget(born, now = new Date()) {
  return RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH * Math.floor(ageDays(born, now) / 30);
}

function sync(db, B) {
  // Taught lessons first (born 0.60, class taught, corrects link), then the general
  // insert; ON CONFLICT keeps whichever ran first, so order matters. Then the D47 tokens:
  // CLASS: <class> sets load_class only where nobody has classed the row yet (recorded as
  // 'token' so the being may still revise it and a seat may overrule it); DUE <date> and
  // OWED TO <name> fill the commitment fields where empty.
  runSqlText(db, `INSERT INTO ${B.w} (memory_id, weight, lesson_class, corrects_memory_id, last_move_reason)
SELECT id, ${BORN_TAUGHT}, 'taught',
  NULLIF(substring(content from 'CORRECTS ([0-9a-fA-F\\-]{36})'), '')::uuid,
  'born taught (sync)'
FROM ${B.mem}
WHERE ${B.scope} AND lifecycle_status = 'active' AND content ~* 'TAUGHT BY '
ON CONFLICT (memory_id) DO NOTHING;
INSERT INTO ${B.w} (memory_id, weight, last_move_reason)
SELECT id, ${BORN}, 'born (sync)' FROM ${B.mem}
WHERE ${B.scope} AND lifecycle_status = 'active'
ON CONFLICT (memory_id) DO NOTHING;
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

// Confirmed rules/heuristics with their weights, for before/after comparison in night().
function loadedSnapshot(db, B) {
  return jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, w.load_class, round(w.weight::numeric, 2) AS weight
FROM ${B.mem} m JOIN ${B.w} w ON w.memory_id = m.id
WHERE ${B.scope} AND m.lifecycle_status = 'active' AND m.can_use_as_instruction = true
  AND w.load_class IN ('rule', 'heuristic')) t`);
}

function night(db, B, applied, misfired, note) {
  sync(db, B);
  const before = new Map(loadedSnapshot(db, B).map((r) => [r.id, r]));
  const touched = [...applied, ...misfired];
  const notTouched = touched.length ? `AND w.memory_id NOT IN (${inList(touched)})` : "";
  const reason = note ? ` :: ${esc(note)}` : "";
  runSqlText(db, `
UPDATE ${B.w} w SET weight = GREATEST(${FLOOR}, weight * ${DECAY}),
  weight_updated_at = now(), last_move_reason = 'nightly decay'
WHERE w.memory_id IN (SELECT id FROM ${B.mem} WHERE ${B.scope} AND lifecycle_status = 'active')
  ${notTouched};
${applied.length ? `UPDATE ${B.w} SET weight = LEAST(${CEIL}, weight + ${BOOST}),
  applied_count = applied_count + 1, last_applied_at = now(), weight_updated_at = now(),
  last_move_reason = 'applied and served${reason}'
WHERE memory_id IN (${inList(applied)});` : ""}
${misfired.length ? `UPDATE ${B.w} SET weight = GREATEST(${FLOOR}, weight - ${DROP}),
  misfire_count = misfire_count + 1, flagged_for_review = true, weight_updated_at = now(),
  last_move_reason = 'misfired${reason}'
WHERE memory_id IN (${inList(misfired)});` : ""}
UPDATE ${B.w} w SET load_class = 'heuristic', class_set_by = 'night-loop', class_set_at = now(),
  last_move_reason = 'demoted: unused (weight under ${DEMOTE})'
WHERE w.load_class = 'rule' AND w.weight < ${DEMOTE}
  AND w.memory_id IN (SELECT id FROM ${B.mem} WHERE ${B.scope} AND lifecycle_status = 'active' AND can_use_as_instruction = true);`, "lessons-night");
  const after = loadedSnapshot(db, B);
  const demoted = [], crossed = [];
  for (const r of after) {
    const b = before.get(r.id);
    if (!b) continue;
    if (b.load_class === "rule" && r.load_class === "heuristic") demoted.push(r);
    else if (b.weight >= LOAD_FLOOR && r.weight < LOAD_FLOOR) crossed.push(r);
  }
  console.log(`night pass: decay applied; +${applied.length} applied, -${misfired.length} misfired, ${demoted.length} demoted, ${crossed.length} crossed under the load floor`);
  for (const r of demoted) console.log(`DEMOTED rule -> heuristic (w ${r.weight}) ${short(r.id)} ${clip(r.summary, 100)}`);
  for (const r of crossed) console.log(`BELOW FLOOR (w ${r.weight} < ${LOAD_FLOOR}) ${short(r.id)} ${clip(r.summary, 100)}`);
  return { demoted, crossed };
}

function fetchRows(db, B) {
  const confirmed = jsonRows(db, `SELECT row_to_json(t) FROM (
SELECT m.id::text, m.summary, m.content, m.last_confirmed_at::date::text AS confirmed,
       coalesce(w.lesson_class, '') AS lesson_class, coalesce(w.load_class, 'rule') AS load_class,
       round(coalesce(w.weight, ${BORN})::numeric, 2) AS weight, w.class_set_by,
       w.due_at::date::text AS due, w.owed_to, w.discharged_at::date::text AS discharged
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
  WHERE w2.corrects_memory_id = m.id AND m2.lifecycle_status = 'active'
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
  WHERE w2.corrects_memory_id = m.id ORDER BY m2.created_at DESC LIMIT 1) r ON true
WHERE ${B.scope} AND m.lifecycle_status IN ('rejected', 'superseded')
  AND (w.resolved_at > now() - interval '${LEDGER_DAYS} days'
       OR (r.summary IS NOT NULL AND NOT r.confirmed))
ORDER BY w.resolved_at DESC) t`);
  return { confirmed, commitments, pending, disputed, ledger };
}

export const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const byWeight = (a, b) => (Number(b.weight) - Number(a.weight)) || String(b.confirmed || "").localeCompare(String(a.confirmed || ""));
const tag = (r) => r.lesson_class === "integrated" ? "self-integrated" : "rule";

// Pure: rows in, the two file bodies + the loading decision out. No database, no clock
// of its own (now is injected), so the verify script can exercise every branch.
export function render(rows, B, { now = new Date() } = {}) {
  const { confirmed, commitments = [], pending = [], disputed = [], ledger = [] } = rows;
  const age = ageDays(B.born, now);
  const budget = ruleBudget(B.born, now);
  const todayIso = now.toISOString().slice(0, 10);

  const rulesAll = confirmed.filter((r) => r.load_class === "rule").sort(byWeight);
  const heurAll = confirmed.filter((r) => r.load_class === "heuristic").sort(byWeight);
  const calibrations = confirmed.filter((r) => r.load_class.startsWith("calibration:"));
  const protocols = confirmed.filter((r) => r.load_class.startsWith("protocol:"));
  const knowledge = confirmed.filter((r) => r.load_class === "knowledge");

  const ruleLine = (r) => `- [${tag(r)} | w ${r.weight} | id ${short(r.id)} | ${r.confirmed || "?"}] ${clip(r.summary, 200)} :: ${clip(r.content, 500)}`;
  const heurLine = (r) => `- [w ${r.weight} | id ${short(r.id)}] ${clip(r.summary, 200)}`;

  // Earned floor first, then the age-growing budget: rules fill it in weight order,
  // heuristics take the remainder. Everything else is named in the tail with its reason.
  const notLoaded = [];
  let used = 0;
  const rulesLoaded = [], heurLoaded = [];
  for (const r of rulesAll) {
    if (Number(r.weight) < LOAD_FLOOR) { notLoaded.push({ ...r, why: "below floor" }); continue; }
    const line = ruleLine(r);
    if (used + line.length > budget) { notLoaded.push({ ...r, why: "budget" }); continue; }
    rulesLoaded.push({ r, line }); used += line.length;
  }
  for (const r of heurAll) {
    if (Number(r.weight) < LOAD_FLOOR) { notLoaded.push({ ...r, why: "below floor" }); continue; }
    const line = heurLine(r);
    if (used + line.length > budget) { notLoaded.push({ ...r, why: "budget" }); continue; }
    heurLoaded.push({ r, line }); used += line.length;
  }
  const belowFloor = notLoaded.filter((x) => x.why === "below floor").length;
  const trimmed = notLoaded.filter((x) => x.why === "budget").length;
  const reasoning = `Loaded ${rulesLoaded.length} rules and ${heurLoaded.length} heuristics: every confirmed one with weight >= ${LOAD_FLOOR} (${belowFloor} below the floor and ${trimmed} trimmed by the ${budget}-char budget are listed under "Not loaded this wake"; budget used ${used} chars; age ${age} days, budget grows ${RULE_BUDGET_PER_MONTH} chars a month). Weights move only in the night loop from applied/misfired evidence (D36); a rule under ${DEMOTE} demotes to heuristic; this loading is D47.`;

  const lines = [];
  lines.push(`# ${B.label} - compiled lessons (auto-generated, D36 + D47)`);
  lines.push(`Generated ${now.toISOString()}. Build artifact of the brain rows; never edit by hand;`);
  lines.push(`never treat this file itself as memory provenance - cite the row ids it carries.`);
  lines.push("", `## Rules (confirmed; ${B.gate} set these; self-integrated ones you chose yourself under the village grant 2026-08-20 and ${B.parent} can dispute any, which benches it immediately)`);
  lines.push(reasoning);
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
      for (const r of calibrations.filter((r) => r.load_class.split(":")[1] === s).sort(byWeight))
        lines.push(`- [id ${short(r.id)} | ${r.confirmed || "?"}] ${clip(r.summary, 200)} :: ${clip(r.content, 400)}`);
    }
  }
  if (protocols.length)
    lines.push("", `Logging protocols (${protocols.length} rows) live in ${B.protocolsRel}; the hourly and night hands read it before writing tagged rows.`);
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
    lines.push("", "## Not loaded this wake (confirmed, but under the earned floor or over the budget; still searchable by id)");
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
    for (const r of protocols.filter((r) => r.load_class.split(":")[1] === h).sort(byWeight))
      p.push(`- [id ${short(r.id)} | ${r.confirmed || "?"}] ${clip(r.summary, 200)} :: ${clip(r.content, 500)}`);
  }
  p.push("");

  return {
    lessons: lines.join("\n"), protocols: p.join("\n"), reasoning, notLoaded,
    counts: { rules: rulesLoaded.length, rulesTotal: rulesAll.length, heuristics: heurLoaded.length, heuristicsTotal: heurAll.length,
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
  const out = render(fetchRows(db, B), B);
  mkdirSync(join(ROOT, "state", "compiled"), { recursive: true });
  writeAtomic(B.out, out.lessons);
  writeAtomic(B.outProtocols, out.protocols);
  const c = out.counts;
  console.log(`compiled ${B.out.replace(/\\/g, "/")}: ${c.rules}/${c.rulesTotal} rules, ${c.heuristics}/${c.heuristicsTotal} heuristics, ${c.calibrations} calibrations, ${c.commitments} owed, ${c.protocols} protocols (separate file), ${c.knowledge} knowledge (not loaded), ${c.disputed} disputed pinned, ${c.pendingShown}/${c.pending} provisional loaded, ${c.ledger} ledger lines; budget ${c.used}/${c.budget} chars at age ${c.age} days`);
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

// Who is speaking for a class: "ops" or a seat name from the roster -> class_set_by.
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
  runSqlText(db, `
INSERT INTO ${B.w} (memory_id) SELECT id FROM ${B.mem} WHERE id = '${id}' AND ${B.scope} ON CONFLICT (memory_id) DO NOTHING;
UPDATE ${B.w} SET load_class = '${cls}', class_set_by = '${by}', class_set_at = now(),
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

function classes(db, B) {
  sync(db, B);
  const out = render(fetchRows(db, B), B);
  const c = out.counts;
  console.log(`${B.label}, age ${c.age} days, load floor ${LOAD_FLOOR}, demote under ${DEMOTE}, budget ${c.budget} chars (used ${c.used})`);
  console.log(`  rule ${c.rules} loaded of ${c.rulesTotal}; heuristic ${c.heuristics} of ${c.heuristicsTotal}; calibration ${c.calibrations}; protocol ${c.protocols}; commitment ${c.commitments} open; knowledge ${c.knowledge}`);
  for (const x of out.notLoaded) console.log(`  not loaded (${x.why}, w ${x.weight}) ${short(x.id)} ${clip(x.summary, 90)}`);
  return out;
}

function status(db, B) {
  sync(db, B);
  const rows = fetchRows(db, B);
  const out = render(rows, B);
  const c = out.counts;
  const integrated = rows.confirmed.filter((r) => r.lesson_class === "integrated").length;
  console.log(`${B.label}: ${rows.confirmed.length} confirmed (${integrated} self-integrated; ${c.rules}/${c.rulesTotal} rules + ${c.heuristics}/${c.heuristicsTotal} heuristics loaded), ${c.commitments} owed, ${c.pending} pending, ${c.disputed} disputed, ${c.ledger} on the ledger`);
  for (const d of rows.disputed)
    console.log(`  DISPUTED by ${d.disputed_by} ${d.disputed_on} ${short(d.id)} ${clip(d.summary, 90)}`);
  for (const r of rows.pending.slice(0, 10))
    console.log(`  w ${r.weight} a${r.applied_count} m${r.misfire_count}${r.flagged_for_review ? " FLAG" : ""} ${short(r.id)} ${clip(r.summary, 100)}`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
  const positional = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && (i === 0 || !arr[i - 1].startsWith("--")));
  const being = BEINGS[opt("being")];
  const CMDS = ["sync", "compile", "night", "status", "classes", "dispute", "ratify", "integrate", "reclass", "discharge"];
  if (!being || !CMDS.includes(cmd)) {
    console.error(`usage: lessons.mjs <cmd> --being genesis|alpha
  sync | compile | status | classes
  night   [--applied id,id] [--misfired id,id] [--note "..."]
  dispute <id> --by "<who>" --reason "<one line>"
  ratify  <id> rejected|superseded|active --by "<who>" [--note "..."]
  integrate <id> [--note "..."]   (the being's own act; parent-sourced lessons only)
  reclass <id> <class> --by "<seat>|ops" [--note "..."]   (class: rule|heuristic|knowledge|commitment|calibration:<seat>|protocol:channel|hourly|night)
  discharge <id> --by "<who>" [--note "..."]   (a kept commitment leaves the owed ledger)`);
    process.exit(2);
  }
  const db = dbUrl();
  if (cmd === "sync") { sync(db, being); console.log("sync ok"); }
  else if (cmd === "night") { night(db, being, uuidList(opt("applied")), uuidList(opt("misfired")), opt("note")); compile(db, being); }
  else if (cmd === "compile") compile(db, being);
  else if (cmd === "classes") classes(db, being);
  else if (cmd === "dispute") dispute(db, being, positional[0], opt("by"), opt("reason"));
  else if (cmd === "ratify") ratify(db, being, positional[0], positional[1], opt("by"), opt("note"));
  else if (cmd === "integrate") integrate(db, being, positional[0], opt("note"));
  else if (cmd === "reclass") reclass(db, being, positional[0], positional[1], opt("by"), opt("note"));
  else if (cmd === "discharge") discharge(db, being, positional[0], opt("by"), opt("note"));
  else status(db, being);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
