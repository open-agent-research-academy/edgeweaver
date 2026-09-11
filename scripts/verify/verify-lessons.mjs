// verify-lessons.mjs - D36/D47/D48 lesson loading, dark (no database, no credentials).
// Asserts: (1) source pins in lessons.mjs (floor, demote, DECAY 0.995, budget constants,
// class regex, ops-credential line, the demote clause excludes pinned rows, the night pass
// runs in one transaction with the ew_night_pass stamp and refuses a repeated diary day,
// evidence gating, the night hand's own rules boost at BOOST_SELF); (2) render() over
// fixtures: rules load above the earned floor in weight order, below-floor and
// budget-trimmed rows are named in the tail with their reason, heuristics are one line,
// calibrations group by seat, protocols leave the main file, the owed ledger shows due /
// no date / OVERDUE, knowledge is a count only, the reasoning line carries the right
// numbers, the Provisional 8k budget holds, the budget grows with age; D48: a pinned row
// loads under the floor, is never trimmed, orders first, counts toward the budget, never
// appears in the tail; pins alone over the budget load and nothing unpinned does; pin
// requests render; the last-night-pass line renders from a stamp; (3) grant shapes in the
// 0006 and 0007 SQL files: EXECUTE on the being's doors to ew_alpha_runtime, sidecar SELECT
// only, no runtime grant on ew_night_pass, REVOKE from PUBLIC, the public wall repair
// (anon/authenticated revoked, RLS on) and the provenance guard in ew_propose_pin, the pin
// guard in dispute and reclass; (4) classSetter, parseEvidence, defaultDiaryDay.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, BEINGS, LOAD_FLOOR, DEMOTE, DECAY, BOOST_SELF, RULE_BUDGET_BASE, RULE_BUDGET_PER_MONTH, CLASS_RE, classSetter, parseEvidence, defaultDiaryDay } from "../lessons/lessons.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

try {
  // 1. source pins
  const src = readFileSync(join(ROOT, "scripts", "lessons", "lessons.mjs"), "utf8");
  check(/export const LOAD_FLOOR = 0\.25, DEMOTE = 0\.20;/.test(src), "LOAD_FLOOR/DEMOTE pin moved");
  check(DECAY === 0.995 && /DECAY = 0\.995/.test(src), "DECAY must be 0.995 (D48 A2)");
  check(BOOST_SELF === 0.05, "BOOST_SELF must be 0.05");
  check(/RULE_BUDGET_BASE = 16000, RULE_BUDGET_PER_MONTH = 2000/.test(src), "budget constants pin moved");
  check(/SUPABASE_DB_URL missing from \.env\.local/.test(src), "ops-credential line missing (weights must move on the ops credential)");
  check(/load_class = 'heuristic', class_set_by = 'night-loop'[\s\S]*?AND load_class = 'rule' AND pinned_by IS NULL;/.test(src), "demote clause must target unpinned rule rows only");
  check(/const sql = `BEGIN;[\s\S]*?INSERT INTO \$\{B\.np\}[\s\S]*?COMMIT;`/.test(src), "night pass must run decay, moves, and the ew_night_pass stamp in one transaction");
  check(/already completed at/.test(src), "night pass must refuse a repeated diary day");
  check(/EVIDENCE UNRESOLVED/.test(src) && /if \(!good\.length\) \{ unresolved\.push/.test(src), "a mark without resolving evidence must be skipped");
  check(/DRY RUN/.test(src) && /if \(!dryRun\) runSqlText\(db, sql, "lessons-night"\)/.test(src), "night --dry-run must write nothing");
  check(/ON CONFLICT \(memory_id\) DO UPDATE SET corrects_memory_id = COALESCE\(w\.corrects_memory_id, EXCLUDED\.corrects_memory_id\)/.test(src), "sync must fill a null corrects link on conflict (D48 A4)");
  check(CLASS_RE.test("calibration:ali") && CLASS_RE.test("protocol:night") && !CLASS_RE.test("protocol:cli") && !CLASS_RE.test("rules"), "CLASS_RE shape");
  check(LOAD_FLOOR > DEMOTE, "floor must sit above the demote threshold (a demoted rule is already unloaded)");

  // 2. render over fixtures
  const B = BEINGS.alpha;
  const now = new Date("2026-09-10T12:00:00Z"); // age 55 days -> budget 16000 + 2000
  const mk = (id, load_class, weight, extra = {}) => ({
    id: id.padEnd(36, "0"), summary: `S-${id}`, content: `C-${id} ${"x".repeat(80)}`, confirmed: "2026-09-01",
    lesson_class: "taught", load_class, weight, class_set_by: null, due: null, owed_to: null, discharged: null,
    pinned_by: null, pin_reason: null, pin_proposed: null, pin_proposed_on: null, ...extra,
  });
  const rows = {
    confirmed: [
      mk("r1", "rule", 0.60), mk("r2", "rule", 0.30), mk("r3", "rule", 0.24), mk("r4", "rule", 0.10),
      mk("rp", "rule", 0.12, { pinned_by: "seat:ali", pin_reason: "protects the record" }),
      mk("rq", "rule", 0.55, { pin_proposed: "please pin: rare occasion, high cost", pin_proposed_on: "2026-09-10" }),
      mk("h1", "heuristic", 0.50), mk("h2", "heuristic", 0.20),
      mk("ca", "calibration:ali", 0.6), mk("cc", "calibration:charlotte", 0.6), mk("ca2", "calibration:ali", 0.7),
      mk("ph", "protocol:hourly", 0.6), mk("pn", "protocol:night", 0.6),
      mk("k1", "knowledge", 0.6), mk("k2", "knowledge", 0.6),
    ],
    commitments: [
      { id: "cm1".padEnd(36, "0"), summary: "report", content: "weekly report", confirmed: false, due: "2026-08-27", owed_to: "Ali", discharged: null },
      { id: "cm2".padEnd(36, "0"), summary: "later", content: "someday", confirmed: true, due: null, owed_to: null, discharged: null },
    ],
    pending: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`.padEnd(36, "0"), summary: `P${i}`, content: "y".repeat(200), born: "2026-09-01", weight: 0.3, applied_count: 0, misfire_count: 0, flagged_for_review: false })),
    disputed: [], ledger: [],
  };
  const lastPass = { diary_day: "2026-09-10", loaded_count: 36, applied_count: 3, misfired_count: 1, occasion_no_mark: ["a"], evidence_unresolved: [], demoted: [], crossed: [], pin_proposed: ["b"] };
  const out = render(rows, B, { now, lastPass });
  const L = out.lessons;
  const between = (a, b) => L.slice(L.indexOf(a), b ? L.indexOf(b) : undefined);
  const rulesSec = between("## Rules", "## Heuristics");
  check(/- \[rule \| pinned by ali \| w 0\.12 \| id rp/.test(rulesSec), "pinned rule loads under the floor with its attribution");
  check(rulesSec.indexOf("id rp") < rulesSec.indexOf("id r1"), "pinned rule orders first");
  check(rulesSec.includes("id r1") && rulesSec.includes("id r2") && rulesSec.indexOf("id r1") < rulesSec.indexOf("id r2"), "unpinned rules above the floor load in weight order");
  check(!rulesSec.includes("id r3") && !rulesSec.includes("id r4"), "below-floor unpinned rules must not load");
  check(/pin requested: please pin/.test(rulesSec), "pin request tag on the line");
  check(out.counts.rules === 4 && out.counts.rulesTotal === 6 && out.counts.pinned === 1, `counts.rules ${out.counts.rules}/${out.counts.rulesTotal} pinned ${out.counts.pinned}`);
  check(/^Loaded 4 rules and 1 heuristics: 1 pinned by a person .* \(3 below the floor and 0 trimmed by the 18000-char budget/m.test(L), "reasoning line numbers (r3, r4, h2 below the floor)");
  check(/^Last night pass \(diary day 2026-09-10\): MARKED 3 applied, 1 misfired of 36 loaded rules; 1 occasions without a provable mark; 0 marks skipped/m.test(L), "last night pass line from the stamp");
  check(out.loadedIds.includes("rp".padEnd(36, "0")) && !out.loadedIds.includes("r3".padEnd(36, "0")), "loadedIds reflect pins and the floor");
  const heurSec = between("## Heuristics", "## Calibrations");
  check(heurSec.includes("- [w 0.5 | id h1") && !heurSec.includes("C-h1"), "heuristic is one line, summary only");
  check(!heurSec.includes("id h2"), "below-floor heuristic must not load");
  check(heurSec.includes("(2 knowledge rows not loaded; recall them by topic)"), "knowledge count line");
  const calSec = between("## Calibrations", "Logging protocols");
  check(calSec.includes("### Ali") && calSec.includes("### Charlotte"), "calibrations grouped by seat");
  check(!L.includes("id ph") && !L.includes("id pn"), "protocol rows must not be in the main file");
  check(L.includes("Logging protocols (2 rows) live in state/compiled/alpha-protocols.md"), "protocols pointer line");
  check(out.protocols.includes("## hourly") && out.protocols.includes("id ph") && out.protocols.includes("## night") && out.protocols.includes("id pn"), "protocols file grouped by hand");
  const reqSec = between("## Pin requests", "## Owed");
  check(/id rq\w* \| asked 2026-09-10\] please pin: rare occasion/.test(reqSec), "pin requests section");
  const owedSec = between("## Owed", "## Provisional");
  check(owedSec.includes("| to Ali | due 2026-08-27 | OVERDUE | pending] report"), "overdue commitment flagged");
  check(owedSec.includes("| to unnamed | due no date] later"), "undated commitment shows no date, no OVERDUE");
  const tail = between("## Not loaded this wake");
  check(/id r3\w* \| below floor/.test(tail) && /id r4\w* \| below floor/.test(tail) && /id h2\w* \| below floor/.test(tail), "tail names below-floor rows with reason");
  check(!/id rp\w*/.test(tail), "pinned row never appears in the tail");
  const provSec = between("## Provisional", "## Not loaded");
  const shown = (provSec.match(/^- \[w /gm) || []).length;
  check(shown < 60 && shown >= 25 && /lower-weight pending lessons not loaded/.test(provSec), `provisional 8k budget holds (shown ${shown})`);
  check(out.counts.budget === RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH, `budget at age 55 days is ${out.counts.budget}`);
  check(out.counts.used > out.counts.pinnedUsed && out.counts.pinnedUsed > 0, "pinned rows count toward used");

  check(/w\.load_class = 'commitment'\s*\n\s*AND w\.discharged_at IS NULL/.test(src), "commitments query must exclude discharged rows");
  check(/AND NOT w\.excluded_from_load AND w\.load_class <> 'commitment'/.test(src), "pending query must exclude commitment rows (they ride the ledger once)");

  // budget trimming: many long rules at age 0 -> lowest weights trimmed with reason; pins survive
  const many = { confirmed: Array.from({ length: 40 }, (_, i) => mk(`b${i}`, "rule", 0.9 - i * 0.01, { content: "z".repeat(600) })), commitments: [], pending: [], disputed: [], ledger: [] };
  many.confirmed.push(mk("bp", "rule", 0.06, { content: "z".repeat(600), pinned_by: "ops", pin_reason: "Alan's word" }));
  const o2 = render(many, B, { now: new Date("2026-07-18T00:00:00Z") });
  check(o2.counts.budget === RULE_BUDGET_BASE, "budget at age 1 day is the base");
  check(o2.counts.rules < 41 && o2.notLoaded.every((x) => x.why === "budget"), `budget trims (${o2.counts.rules} loaded, ${o2.notLoaded.length} trimmed)`);
  check(o2.loadedIds.includes("bp".padEnd(36, "0")) && !o2.notLoaded.some((x) => x.id.startsWith("bp")), "pinned row survives budget trimming");
  const o3 = render(many, B, { now: new Date("2026-08-17T00:00:00Z") }); // 31 days
  check(o3.counts.budget === RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH && o3.counts.rules > o2.counts.rules, "budget grows with age and loads more");
  // pins alone over the budget: all pins load, nothing unpinned does, reasoning says so
  const pinsOnly = { confirmed: Array.from({ length: 30 }, (_, i) => mk(`q${i}`, "rule", 0.5, { content: "z".repeat(700), pinned_by: "seat:ali" })).concat([mk("u1", "rule", 0.9, { content: "z".repeat(100) })]), commitments: [], pending: [], disputed: [], ledger: [] };
  const o4 = render(pinsOnly, B, { now: new Date("2026-07-18T00:00:00Z") });
  check(o4.counts.overrun && o4.counts.pinned === 30 && !o4.loadedIds.includes("u1".padEnd(36, "0")) && /pins alone exceed the budget/.test(o4.reasoning), "pins over budget: all pins load, nothing unpinned, reasoning names it");

  // 3. grant shapes
  const alpha6 = readFileSync(join(ROOT, "brains", "schema", "ew-alpha-0006-lesson-classes.sql"), "utf8");
  const grants6 = alpha6.match(/GRANT [^;]+;/g) || [];
  check(grants6.length === 3, `ew-alpha-0006 has ${grants6.length} GRANT statements (expected exactly 3)`);
  check(grants6.some((g) => g === "GRANT SELECT ON ew_alpha.ew_lesson_weights TO ew_alpha_runtime;"), "0006 sidecar table grant is SELECT only");
  const alpha7 = readFileSync(join(ROOT, "brains", "schema", "ew-alpha-0007-lesson-pins.sql"), "utf8");
  const grants7 = alpha7.match(/GRANT [^;]+;/g) || [];
  check(grants7.filter((g) => /GRANT EXECUTE ON FUNCTION ew_alpha\.ew_(propose_pin|dispute_lesson|reclass_lesson)\([^)]*\) TO ew_alpha_runtime;/.test(g)).length === 3, "0007 grants EXECUTE on the three doors to ew_alpha_runtime");
  check(grants7.filter((g) => /ON ew_alpha\.\w+ TO/.test(g)).every((g) => g === "GRANT SELECT ON ew_alpha.ew_lesson_weights TO ew_alpha_runtime;"), "0007 table grants are the sidecar SELECT only");
  check(/REVOKE ALL ON ew_alpha\.ew_night_pass FROM ew_alpha_runtime;/.test(alpha7), "runtime role revoked from ew_night_pass");
  check((alpha7.match(/REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/g) || []).length === 3, "0007 alpha: three functions revoked from PUBLIC");
  check(/memory_type = 'lesson' AND lifecycle_status = 'active' AND can_use_as_instruction = true\) THEN\s*\n\s*RETURN 'refused: not a confirmed active lesson/.test(alpha7), "ew_propose_pin provenance guard (alpha)");
  check((alpha7.match(/proposal recorded: this lesson is pinned by/g) || []).length === 2, "dispute and reclass honour pins (alpha)");
  const pub7 = readFileSync(join(ROOT, "brains", "schema", "migrations", "0007-lesson-pins.sql"), "utf8");
  check(/REVOKE ALL ON ew_lesson_weights FROM anon;/.test(pub7) && /REVOKE ALL ON ew_lesson_weights FROM authenticated;/.test(pub7) && /ALTER TABLE ew_lesson_weights ENABLE ROW LEVEL SECURITY;/.test(pub7), "public wall repair in 0007");
  check(/ALTER TABLE ew_night_pass ENABLE ROW LEVEL SECURITY;/.test(pub7), "public ew_night_pass under RLS");
  check(/workspace_id = 'edgeweaver'\s*\n\s*AND memory_type = 'lesson' AND lifecycle_status = 'active' AND can_use_as_instruction = true\)/.test(pub7), "ew_propose_pin provenance guard incl. workspace (public)");
  check((pub7.match(/proposal recorded: this lesson is pinned by/g) || []).length === 2, "dispute and reclass honour pins (public)");
  check((pub7.match(/REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/g) || []).length === 3, "0007 public: three functions revoked from PUBLIC");
  check(/v_by LIKE 'seat:%' OR v_by = 'ops'/.test(pub7) && /v_by LIKE 'seat:%' OR v_by = 'ops'/.test(alpha7), "being reclass still refuses a seat's class in both schemas");

  // 4. helpers
  check(classSetter(BEINGS.alpha, "Ali") === "seat:ali" && classSetter(BEINGS.genesis, "ops") === "ops", "classSetter maps seat and ops");
  let threw = false; try { classSetter(BEINGS.genesis, "ali"); } catch { threw = true; }
  check(threw, "classSetter refuses a non-roster seat");
  const ev = parseEvidence("11111111-1111-1111-1111-111111111111=22222222-2222-2222-2222-222222222222+33333333-3333-3333-3333-333333333333");
  check(ev.get("11111111-1111-1111-1111-111111111111")?.length === 2, "parseEvidence splits rule and thought ids");
  threw = false; try { parseEvidence("nope=22222222-2222-2222-2222-222222222222"); } catch { threw = true; }
  check(threw, "parseEvidence refuses a non-uuid rule id");
  check(/^\d{4}-\d{2}-\d{2}$/.test(defaultDiaryDay(new Date("2026-09-11T05:00:00Z"))) && defaultDiaryDay(new Date("2026-09-11T05:00:00Z")) === "2026-09-10", "defaultDiaryDay follows the T minus 12h rule in the being's zone");
} catch (e) {
  fails.push("exception: " + e.message + "\n" + e.stack);
}

if (fails.length) { console.log("FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("PASS: verify-lessons (D47 floor/budget/classes + D48 pins, evidence-gated night pass, wall repairs; source pins, fixtures, grant shapes)");
