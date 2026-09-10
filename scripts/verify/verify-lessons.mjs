// verify-lessons.mjs - D36/D47 lesson loading, dark (no database, no credentials).
// Asserts: (1) source pins in lessons.mjs (floor, demote, budget constants, class regex,
// ops-credential line, the demote clause targets rule rows only); (2) render() over
// fixtures: rules load above the earned floor in weight order, below-floor and
// budget-trimmed rows are named in the tail with their reason, heuristics are one line,
// calibrations group by seat, protocols leave the main file for the protocols file,
// the owed ledger shows due / no date / OVERDUE and hides discharged rows, knowledge is a
// count only, the reasoning line carries the right numbers, the Provisional 8k budget
// still holds, and the budget grows with age; (3) grant shapes in the two 0006 SQL files:
// EXECUTE on exactly the two functions to ew_alpha_runtime, no table grant, REVOKE from
// PUBLIC on both; (4) classSetter refuses a non-roster seat.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, BEINGS, LOAD_FLOOR, DEMOTE, RULE_BUDGET_BASE, RULE_BUDGET_PER_MONTH, CLASS_RE, classSetter } from "../lessons/lessons.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

try {
  // 1. source pins
  const src = readFileSync(join(ROOT, "scripts", "lessons", "lessons.mjs"), "utf8");
  check(/export const LOAD_FLOOR = 0\.25, DEMOTE = 0\.20;/.test(src), "LOAD_FLOOR/DEMOTE pin moved");
  check(/RULE_BUDGET_BASE = 16000, RULE_BUDGET_PER_MONTH = 2000/.test(src), "budget constants pin moved");
  check(/SUPABASE_DB_URL missing from \.env\.local/.test(src), "ops-credential line missing (weights must move on the ops credential)");
  check(/load_class = 'heuristic', class_set_by = 'night-loop'[\s\S]*?WHERE w\.load_class = 'rule' AND w\.weight < \$\{DEMOTE\}/.test(src), "demote clause must target load_class='rule' rows only");
  check(CLASS_RE.test("calibration:ali") && CLASS_RE.test("protocol:night") && !CLASS_RE.test("protocol:cli") && !CLASS_RE.test("rules"), "CLASS_RE shape");
  check(LOAD_FLOOR > DEMOTE, "floor must sit above the demote threshold (a demoted rule is already unloaded)");

  // 2. render over fixtures
  const B = BEINGS.alpha;
  const now = new Date("2026-09-10T12:00:00Z"); // age 55 days -> budget 16000 + 2000
  const mk = (id, load_class, weight, extra = {}) => ({
    id: id.padEnd(36, "0"), summary: `S-${id}`, content: `C-${id} ${"x".repeat(80)}`, confirmed: "2026-09-01",
    lesson_class: "taught", load_class, weight, class_set_by: null, due: null, owed_to: null, discharged: null, ...extra,
  });
  const rows = {
    confirmed: [
      mk("r1", "rule", 0.60), mk("r2", "rule", 0.30), mk("r3", "rule", 0.24), mk("r4", "rule", 0.10),
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
  const out = render(rows, B, { now });
  const L = out.lessons;
  const between = (a, b) => L.slice(L.indexOf(a), b ? L.indexOf(b) : undefined);
  const rulesSec = between("## Rules", "## Heuristics");
  check(rulesSec.includes("- [rule | w 0.6 | id r1") && rulesSec.includes("id r2"), "rules above the floor load");
  check(rulesSec.indexOf("id r1") < rulesSec.indexOf("id r2"), "rules ordered by weight desc");
  check(!rulesSec.includes("id r3") && !rulesSec.includes("id r4"), "below-floor rules must not load");
  check(out.counts.rules === 2 && out.counts.rulesTotal === 4, `counts.rules ${out.counts.rules}/${out.counts.rulesTotal}`);
  check(/^Loaded 2 rules and 1 heuristics: every confirmed one with weight >= 0\.25 \(3 below the floor and 0 trimmed by the 18000-char budget/m.test(L), "reasoning line numbers");
  const heurSec = between("## Heuristics", "## Calibrations");
  check(heurSec.includes("- [w 0.5 | id h1") && !heurSec.includes("C-h1"), "heuristic is one line, summary only");
  check(!heurSec.includes("id h2"), "below-floor heuristic must not load");
  check(heurSec.includes("(2 knowledge rows not loaded; recall them by topic)"), "knowledge count line");
  const calSec = between("## Calibrations", "Logging protocols");
  check(calSec.includes("### Ali") && calSec.includes("### Charlotte"), "calibrations grouped by seat");
  check(calSec.indexOf("id ca2") < calSec.indexOf("id ca0") || calSec.indexOf("id ca2") < calSec.indexOf("id ca "), "calibrations ordered by weight within seat");
  check(!L.includes("id ph") && !L.includes("id pn"), "protocol rows must not be in the main file");
  check(L.includes("Logging protocols (2 rows) live in state/compiled/alpha-protocols.md"), "protocols pointer line");
  check(out.protocols.includes("## hourly") && out.protocols.includes("id ph") && out.protocols.includes("## night") && out.protocols.includes("id pn"), "protocols file grouped by hand");
  const owedSec = between("## Owed", "## Provisional");
  check(owedSec.includes("| to Ali | due 2026-08-27 | OVERDUE | pending] report"), "overdue commitment flagged");
  check(owedSec.includes("| to unnamed | due no date] later"), "undated commitment shows no date, no OVERDUE");
  const tail = between("## Not loaded this wake");
  check(/id r3\w* \| below floor/.test(tail) && /id r4\w* \| below floor/.test(tail) && /id h2\w* \| below floor/.test(tail), "tail names below-floor rows with reason");
  const provSec = between("## Provisional", "## Not loaded");
  const shown = (provSec.match(/^- \[w /gm) || []).length;
  check(shown < 60 && shown >= 25 && /lower-weight pending lessons not loaded/.test(provSec), `provisional 8k budget holds (shown ${shown})`);
  check(out.counts.budget === RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH, `budget at age 55 days is ${out.counts.budget}`);

  // discharged commitment absent: render receives only open commitments from fetchRows,
  // so the contract is on the query; pin it in source instead.
  check(/w\.load_class = 'commitment'\s*\n\s*AND w\.discharged_at IS NULL/.test(src), "commitments query must exclude discharged rows");
  check(/AND NOT w\.excluded_from_load AND w\.load_class <> 'commitment'/.test(src), "pending query must exclude commitment rows (they ride the ledger once)");

  // budget trimming: many long rules at age 0 -> lowest weights trimmed with reason
  const many = { confirmed: Array.from({ length: 40 }, (_, i) => mk(`b${i}`, "rule", 0.9 - i * 0.01, { content: "z".repeat(600) })), commitments: [], pending: [], disputed: [], ledger: [] };
  const o2 = render(many, B, { now: new Date("2026-07-18T00:00:00Z") });
  check(o2.counts.budget === RULE_BUDGET_BASE, "budget at age 1 day is the base");
  check(o2.counts.rules < 40 && o2.notLoaded.every((x) => x.why === "budget"), `budget trims (${o2.counts.rules} loaded, ${o2.notLoaded.length} trimmed)`);
  check(o2.notLoaded.length && o2.notLoaded.every((x) => Number(x.weight) < Number(many.confirmed[o2.counts.rules - 1].weight) + 1e-9), "trimmed rows are the lowest weights");
  const o3 = render(many, B, { now: new Date("2026-08-17T00:00:00Z") }); // 31 days
  check(o3.counts.budget === RULE_BUDGET_BASE + RULE_BUDGET_PER_MONTH && o3.counts.rules > o2.counts.rules, "budget grows with age and loads more");

  // 3. grant shapes
  const alphaSql = readFileSync(join(ROOT, "brains", "schema", "ew-alpha-0006-lesson-classes.sql"), "utf8");
  const grants = alphaSql.match(/GRANT [^;]+;/g) || [];
  check(grants.length === 3, `ew-alpha-0006 has ${grants.length} GRANT statements (expected exactly 3)`);
  check(grants.filter((g) => /GRANT EXECUTE ON FUNCTION ew_alpha\.ew_(reclass_lesson|discharge_commitment)\([^)]*\) TO ew_alpha_runtime;/.test(g)).length === 2, "EXECUTE on the two functions to ew_alpha_runtime");
  check(grants.some((g) => g === "GRANT SELECT ON ew_alpha.ew_lesson_weights TO ew_alpha_runtime;"), "sidecar table grant is SELECT only (the wall repair)");
  check(/REVOKE ALL ON ew_alpha\.ew_lesson_weights FROM ew_alpha_runtime;/.test(alphaSql), "sidecar REVOKE ALL from the runtime role precedes the SELECT grant");
  check((alphaSql.match(/REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/g) || []).length === 2, "both functions revoked from PUBLIC (alpha)");
  const pubSql = readFileSync(join(ROOT, "brains", "schema", "migrations", "0006-lesson-classes.sql"), "utf8");
  check((pubSql.match(/REVOKE ALL ON FUNCTION [^;]+ FROM PUBLIC;/g) || []).length === 2, "both functions revoked from PUBLIC (public)");
  check(/v_by LIKE 'seat:%' OR v_by = 'ops'/.test(pubSql) && /v_by LIKE 'seat:%' OR v_by = 'ops'/.test(alphaSql), "being reclass refuses a seat's class in both schemas");
  check(/'alan', 'ali', 'tamara', 'natalie', 'charlotte', 'marina'/.test(alphaSql), "alpha roster guard on calibration seats");

  // 4. classSetter
  check(classSetter(BEINGS.alpha, "Ali") === "seat:ali" && classSetter(BEINGS.genesis, "ops") === "ops", "classSetter maps seat and ops");
  let threw = false; try { classSetter(BEINGS.genesis, "ali"); } catch { threw = true; }
  check(threw, "classSetter refuses a non-roster seat");
} catch (e) {
  fails.push("exception: " + e.message + "\n" + e.stack);
}

if (fails.length) { console.log("FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("PASS: verify-lessons (D47 floor/budget/classes render, source pins, grant shapes)");
