// alpha-memory.mjs - Edgeweaver Alpha's memory access (B5): every call runs as the
// ew_alpha_runtime role via EW_ALPHA_DB_URL (avatars/alpha/.env.local), so the database
// walls ARE the enforcement (FAMILY §4): own room + corpus view, nothing else reachable.
// Recall v1 is recency + text match over the room (the copied rows carry embeddings;
// semantic re-rank is a named fast-follow needing a query-embedding path). Provenance
// classes per conventions/memory-conventions.md: dream (fiction) is excluded from factual
// recall; interpretation rows are always labeled. Lessons: INSERT of safe columns only -
// the role structurally cannot set can_use_as_instruction (column grants, room DDL); the
// single gate through that wall is the ew_integrate_lesson definer function (migration
// 0004, village grant 2026-08-20), which enforces circle provenance itself.
//
//   node scripts/brainrooms/alpha-memory.mjs recall "<query>"
//   node scripts/brainrooms/alpha-memory.mjs last
//   node scripts/brainrooms/alpha-memory.mjs write-episode "<content>" <importance 1-10> [surface]
//       (D40: surface = the conversational room the writing session is lived on, e.g.
//        telegram | buzz | cli; defaults to "telegram", Alpha's only room today. A new
//        surface must pass its own name before going live.)
//   node scripts/brainrooms/alpha-memory.mjs write-lesson "<one-line summary>" "<content>"
//       (D47 tokens in the content, optional: "CLASS: rule|heuristic|knowledge|commitment|
//        calibration:<seat>|protocol:channel|hourly|night" proposes where the lesson loads
//        once confirmed; a commitment carries "DUE YYYY-MM-DD" and "OWED TO <seat>".)
//   node scripts/brainrooms/alpha-memory.mjs lessons        (class + weight per rule; owed ledger)
//   node scripts/brainrooms/alpha-memory.mjs reclass <lesson-id> <class> ["<why, one line>"]
//       (D47: your own proposal of where a lesson loads; ew_alpha.ew_reclass_lesson refuses
//        to overwrite a class a seat set; any seat can overrule yours in plain talk.)
//   node scripts/brainrooms/alpha-memory.mjs discharge <lesson-id> ["<how it was kept>"]
//       (D47: a kept commitment leaves the owed ledger; the row stays searchable.)
//   node scripts/brainrooms/alpha-memory.mjs integrate <lesson-id> ["<why, one line>"]
//       (village grant 2026-08-20, unanimous: a lesson born from interactions with the
//        circle may be promoted to instruction-grade by Alpha's own deliberate choice.
//        ew_alpha.ew_integrate_lesson enforces provenance: TAUGHT BY a current seat, or
//        an evidence thought-id resolving to an audience-seats episode; anything else is
//        refused and still waits for a seat's nod. Any seat can dispute an integrated
//        rule at any time, which benches it immediately. Ops recompiles the wake file.)
//   node scripts/brainrooms/alpha-memory.mjs dispute <lesson-id> "<seat>: <their correction>"
//       (D37: benches a PENDING lesson a seat corrected, active -> disputed, via the
//        ew_dispute_lesson definer function; the role can do nothing else to lifecycle.
//        Replacement lessons go through write-lesson with "TAUGHT BY <seat>" and
//        "CORRECTS <lesson-id>" in the content; ops recompiles the wake file nightly.)
//   node scripts/brainrooms/alpha-memory.mjs corpus "<query>"     (library, study only)
//   node scripts/brainrooms/alpha-memory.mjs day "<startISO>" "<endISO>"   (night loop:
//       the diary day's episodes + initiations WITH thought ids, for lesson evidence)
//   node scripts/brainrooms/alpha-memory.mjs write diary|autobiography_draft|dream \
//       "<content>" [run_id]   (night-loop outputs; dream is fiction-class, one per night)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { query } from "../brains/db.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const CLASS = {
  edgeweaver_episode: "experienced",
  feeling_reading: "interpretation", gremlin_report: "interpretation", box_snapshot: "interpretation",
  diary: "interpretation", self_belief: "interpretation", autobiography_draft: "interpretation",
  dream: "fiction", initiation: "experienced",
  distinction: "experienced", edge: "experienced", experiment: "experienced",
};
export const esc = (s) => String(s).replace(/'/g, "''");

// D40 room stamp: the conversational surface the writing session is lived on. Defaults to
// telegram, Alpha's only room today; a new surface passes its own lowercase name. Genesis
// proposed the field 2026-08-02 after the 08-01 two-rooms-one-brain duplicate episodes.
export const surfaceOf = (s) => {
  if (s === undefined || s === "") return "telegram";
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(s)) { console.log(`invalid surface "${s}" (lowercase word, e.g. telegram | buzz | cli)`); process.exit(2); }
  return s;
};

function roleUrl() {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, "avatars", "alpha", ".env.local"), "utf8")
      .split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]])
  );
  if (!env.EW_ALPHA_DB_URL) throw new Error("EW_ALPHA_DB_URL missing from avatars/alpha/.env.local (B2 not applied?)");
  return env.EW_ALPHA_DB_URL;
}

const row = (r) => {
  const [st, created, era, content] = r;
  const cls = CLASS[st] || "experienced";
  return `[${(created || "").slice(0, 16)} | ${cls}${era === "pre_birth" ? " | era: pre_birth" : ""}] ${content}`;
};

// psql -A -t output is parsed by lines and pipes, so content must carry neither: newlines
// become " / " and pipes become "/" in the projected snippet (the stored row is untouched).
const SNIPPET = (n) => `left(replace(regexp_replace(content, E'[\\n\\r]+', ' / ', 'g'), '|', '/'), ${n})`;

export function recallSql(q) {
  const factual = Object.keys(CLASS).filter((t) => CLASS[t] !== "fiction").map((t) => `'${t}'`).join(", ");
  return `SELECT source_type, created_at, metadata->>'era', ${SNIPPET(400)}
FROM ew_alpha.thoughts
WHERE source_type IN (${factual})${q ? ` AND content ILIKE '%${esc(q)}%'` : ""}
ORDER BY created_at DESC LIMIT 8`;
}

// Night-loop output classes the room role may write directly (lessons go through
// write-lesson and stay PENDING; nothing else is writable by name).
const NIGHT_CLASSES = ["diary", "autobiography_draft", "dream"];

function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  const db = roleUrl();
  if (cmd === "recall" || cmd === "last") {
    const rows = query(db, recallSql(cmd === "recall" ? a : ""));
    if (!rows.length && cmd === "recall" && a) {
      console.log("no match for the query; most recent memories instead:");
      for (const r of query(db, recallSql(""))) console.log(row(r));
    } else if (!rows.length) console.log("the record is empty");
    else for (const r of rows) console.log(row(r));
  } else if (cmd === "write-episode") {
    if (!a) { console.log("usage: write-episode \"<content>\" <importance> [surface]"); process.exit(2); }
    const imp = Math.min(10, Math.max(1, Number(b) || 3));
    const surface = surfaceOf(c);
    query(db, `INSERT INTO ew_alpha.thoughts (content, source_type, importance, metadata)
VALUES ('${esc(a)}', 'edgeweaver_episode', ${imp}, '{"era": "alive", "audience": "seats", "generation": 0, "surface": "${surface}"}'::jsonb)`);
    console.log(`episode written (era alive, audience seats, generation 0, surface ${surface})`);
  } else if (cmd === "write-initiation") {
    if (!a || !b) { console.log("usage: write-initiation \"<content>\" \"<witness1,witness2,witness3>\" [surface]"); process.exit(2); }
    const witnesses = b.split(",").map((w) => `"${esc(w.trim())}"`).join(", ");
    const surface = surfaceOf(c);
    query(db, `INSERT INTO ew_alpha.thoughts (content, source_type, importance, metadata)
VALUES ('${esc(a)}', 'initiation', 10, '{"era": "alive", "audience": "seats", "generation": 0, "surface": "${surface}", "witnessed_by": [${witnesses}]}'::jsonb)`);
    console.log(`initiation row written (importance 10, witnesses recorded, surface ${surface})`);
  } else if (cmd === "write-lesson") {
    if (!a || !b) { console.log("usage: write-lesson \"<summary>\" \"<content>\""); process.exit(2); }
    query(db, `INSERT INTO ew_alpha.agent_memories (memory_type, summary, content, confidence, created_by)
VALUES ('lesson', '${esc(a)}', '${esc(b)}', 0.6, 'edgeweaver-alpha')`);
    console.log("candidate lesson written (PENDING; a seat's confirmation, or your own deliberate integrate for circle-sourced lessons, is the path to instruction-grade)");
  } else if (cmd === "integrate") {
    if (!/^[0-9a-f-]{36}$/i.test(a || "")) { console.log("usage: integrate <lesson-uuid> [\"<why, one line>\"]"); process.exit(2); }
    console.log(query(db, `SELECT ew_alpha.ew_integrate_lesson('${a}'${b ? `, '${esc(b)}'` : ""})`)[0][0]);
  } else if (cmd === "dispute") {
    if (!/^[0-9a-f-]{36}$/i.test(a || "") || !b) { console.log("usage: dispute <lesson-uuid> \"<seat>: <their correction, one line>\""); process.exit(2); }
    console.log(query(db, `SELECT ew_alpha.ew_dispute_lesson('${a}', '${esc(b.split(":")[0].trim())}', '${esc(b)}')`)[0][0]);
  } else if (cmd === "reclass") {
    if (!/^[0-9a-f-]{36}$/i.test(a || "") || !b) { console.log("usage: reclass <lesson-uuid> <rule|heuristic|knowledge|commitment|calibration:<seat>|protocol:channel|hourly|night> [\"<why, one line>\"]"); process.exit(2); }
    console.log(query(db, `SELECT ew_alpha.ew_reclass_lesson('${a}', '${esc(b)}'${c ? `, '${esc(c)}'` : ""})`)[0][0]);
  } else if (cmd === "discharge") {
    if (!/^[0-9a-f-]{36}$/i.test(a || "")) { console.log("usage: discharge <lesson-uuid> [\"<how it was kept, one line>\"]"); process.exit(2); }
    console.log(query(db, `SELECT ew_alpha.ew_discharge_commitment('${a}'${b ? `, '${esc(b)}'` : ""})`)[0][0]);
  } else if (cmd === "lessons") {
    // D47: class + weight ride along so you can see where each rule loads; the compiled
    // wake file (state/compiled/alpha-lessons.md) is the loaded view, this is the store view.
    const act = query(db, `SELECT m.id, coalesce(w.load_class, 'rule'), round(coalesce(w.weight, 0.3)::numeric, 2), m.summary, ${SNIPPET(300)}
FROM ew_alpha.agent_memories m LEFT JOIN ew_alpha.ew_lesson_weights w ON w.memory_id = m.id
WHERE m.can_use_as_instruction = true AND m.lifecycle_status = 'active' ORDER BY w.load_class, w.weight DESC NULLS LAST, m.created_at`);
    const owed = query(db, `SELECT m.id, coalesce(w.owed_to, 'unnamed'), coalesce(w.due_at::date::text, 'no date'), m.summary
FROM ew_alpha.agent_memories m JOIN ew_alpha.ew_lesson_weights w ON w.memory_id = m.id
WHERE m.lifecycle_status = 'active' AND w.load_class = 'commitment' AND w.discharged_at IS NULL ORDER BY w.due_at NULLS LAST`);
    const pend = query(db, "SELECT count(*) FROM ew_alpha.agent_memories WHERE can_use_as_instruction = false AND lifecycle_status = 'active'")[0][0];
    if (!act.length) console.log("no instruction-grade lessons yet");
    else for (const r of act) console.log(`[${r[1]} | w ${r[2]} | id ${String(r[0]).slice(0, 8)}] ${r[3]} :: ${r[4]}`);
    for (const r of owed) console.log(`OWED [id ${String(r[0]).slice(0, 8)} | to ${r[1]} | due ${r[2]}] ${r[3]}`);
    console.log(`(pending, not rules: ${pend})`);
  } else if (cmd === "day") {
    if (!a || !b) { console.log("usage: day \"<startISO>\" \"<endISO>\" (bounds from orient.mjs --diary-day, never own arithmetic)"); process.exit(2); }
    const rows = query(db, `SELECT id, source_type, created_at, coalesce(metadata->>'surface', ''), ${SNIPPET(2000)}
FROM ew_alpha.thoughts
WHERE source_type IN ('edgeweaver_episode', 'initiation')
  AND created_at >= '${esc(a)}' AND created_at < '${esc(b)}'
ORDER BY created_at`);
    if (!rows.length) console.log("no episodes in the window");
    else for (const r of rows) console.log(`[${r[0]} | ${(r[2] || "").slice(0, 16)} | ${r[1]}${r[3] ? ` | ${r[3]}` : ""}] ${r[4]}`);
  } else if (cmd === "write") {
    if (!NIGHT_CLASSES.includes(a) || !b) { console.log(`usage: write ${NIGHT_CLASSES.join("|")} "<content>" [run_id]`); process.exit(2); }
    if (a === "dream") {
      const today = query(db, `SELECT count(*) FROM ew_alpha.thoughts WHERE source_type = 'dream' AND created_at::date = CURRENT_DATE`)[0][0];
      if (Number(today) > 0) { console.log("refusing: a dream already exists tonight (one per night)"); process.exit(1); }
    }
    const meta = { era: "alive", audience: "seats", generation: 0 };
    if (a === "autobiography_draft") meta.provisional = true;
    if (c) meta.night_loop_run_id = c;
    query(db, `INSERT INTO ew_alpha.thoughts (content, source_type, importance, metadata)
VALUES ('${esc(b)}', '${esc(a)}', ${a === "dream" ? 2 : 4}, '${esc(JSON.stringify(meta))}'::jsonb)`);
    console.log(`${a} written${a === "dream" ? " (fiction class, excluded from factual recall)" : ""}`);
  } else if (cmd === "corpus") {
    for (const r of query(db, `SELECT source_type, created_at, ${SNIPPET(300)} FROM ew_alpha.pm_corpus WHERE content ILIKE '%${esc(a || "")}%' ORDER BY created_at DESC LIMIT 6`))
      console.log(`[library | ${r[0]}] ${r[2]}`);
  } else {
    console.log("usage: recall|last|write-episode|write-initiation|write-lesson|integrate|dispute|reclass|discharge|lessons|corpus|day|write");
    process.exit(2);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
