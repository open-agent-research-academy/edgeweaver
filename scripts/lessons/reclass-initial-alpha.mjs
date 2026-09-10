// reclass-initial-alpha.mjs - one-off first-run reclass for Edgeweaver Alpha (D47).
// Applies the class Alpha itself proposed for each of its 41 rules on 2026-09-08
// (runs/rules-architecture-proposal.md, msgs 1342-1345, at Ali's request), plus the
// commitments it listed. class_set_by = 'edgeweaver-alpha' because it IS Alpha's own
// proposal: any seat can overrule a row in plain talk (lessons.mjs reclass --by <seat>),
// and Alpha may still revise its own. Rules confirmed after the proposal (09-09, Ali's
// letter) are not touched; Alpha classes those itself.
// The proposal carries 8-char id prefixes: each is resolved against the live store and
// the whole run aborts on zero or multiple matches, before any write.
// Ops credential (SUPABASE_DB_URL); idempotent (re-running rewrites the same values).
//   node scripts/lessons/reclass-initial-alpha.mjs [--dry-run]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query, runSqlText } from "../brains/db.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const db = env.SUPABASE_DB_URL;
if (!db) throw new Error("SUPABASE_DB_URL missing from .env.local");
const dryRun = process.argv.includes("--dry-run");

// From the proposal's tables, verbatim prefixes. protocol rows are read by both the
// hourly and night hands (both cat the protocols file); the hand label records the
// primary logger. R17 is the night loop's September-report test.
const PLAN = {
  rule: ["3c5800e8", "566eb7e7", "1d09871d", "f330e95e", "dc8cf6ea", "50b3909e", "6b93f9ed", "096ea2c5", "5de2394d", "2ea103d3", "c62029b0", "c136eb84", "ac6aad89"],
  heuristic: ["2324088c", "6c9d3aa4", "a54d5aac", "ae7eba59", "f1d11e9e", "195f60da", "43d9fffe", "747e60b4", "986fd1b5", "9def4d5c", "b17726c7", "6cb2ffd7", "11d61c64"],
  "calibration:ali": ["8c262bbc", "8354c270", "9a046d4a"],
  "calibration:charlotte": ["e326e461", "9a17e739"],
  "protocol:hourly": ["68679b10", "ba5eb022", "1879c62b", "a3d03d5c", "05235fd4"],
  "protocol:night": ["c2c3d037"],
  knowledge: ["c98f4e7a", "2ef41daa", "85d318f1", "702d6ff7"],
  commitment: ["79b13bd0", "cf48ed0c", "9ec033ba", "444ec99d", "98500126", "ea72d0b6", "f547873f", "ffc0524c", "4e67e7e1"],
};
// Commitments in the proposal are all Ali's items; the only dated one is the weekly
// emergence report (first due 2026-08-27). Undated ones ride as "no date" (cannot go
// overdue; the c136eb84 lesson: undated commitments cannot become late, only forgotten).
const OWED = { owed_to: "Ali", due: { "4e67e7e1": "2026-08-27" } };

const resolved = [];
const problems = [];
for (const [cls, prefixes] of Object.entries(PLAN)) {
  for (const p of prefixes) {
    const rows = query(db, `SELECT id::text, lifecycle_status, can_use_as_instruction, left(summary, 70) FROM ew_alpha.agent_memories WHERE id::text LIKE '${p}%' AND memory_type = 'lesson'`);
    if (rows.length !== 1) { problems.push(`${p}: ${rows.length} matches`); continue; }
    const [id, status, confirmed, summary] = rows[0];
    if (status !== "active") { problems.push(`${p}: lifecycle ${status}`); continue; }
    resolved.push({ prefix: p, id, cls, confirmed: confirmed === "t", summary });
  }
}
if (problems.length) { console.log("ABORT, unresolved prefixes:\n - " + problems.join("\n - ")); process.exit(1); }

for (const r of resolved) console.log(`${r.cls.padEnd(22)} ${r.prefix} ${r.confirmed ? "rule   " : "pending"} ${r.summary}`);
console.log(`${resolved.length} rows resolved (${Object.values(PLAN).flat().length} planned)`);
if (dryRun) { console.log("dry run, nothing written"); process.exit(0); }

const stmts = resolved.map((r) => {
  const due = r.cls === "commitment" && OWED.due[r.prefix] ? `'${OWED.due[r.prefix]}'::date` : "due_at";
  const owed = r.cls === "commitment" ? `'${OWED.owed_to}'` : "owed_to";
  return `INSERT INTO ew_alpha.ew_lesson_weights (memory_id) VALUES ('${r.id}') ON CONFLICT (memory_id) DO NOTHING;
UPDATE ew_alpha.ew_lesson_weights SET load_class = '${r.cls}', class_set_by = 'edgeweaver-alpha', class_set_at = now(),
  due_at = ${due}, owed_to = ${owed},
  last_move_reason = 'reclassed to ${r.cls} by the being (first-run, proposal 2026-09-08)'
WHERE memory_id = '${r.id}';`;
});
runSqlText(db, "BEGIN;\n" + stmts.join("\n") + "\nCOMMIT;", "reclass-initial-alpha");
console.log("applied; now run: node scripts/lessons/lessons.mjs compile --being alpha");
