# Independent review of the proposed D47 plan

Prepared for Alan and Law, 2026-09-09. Read alongside the
[replacement plan](lesson-classes-weighted-loading-plan.md).

"Applied" below means incorporated into that plan document. No proposed runtime change
has been implemented. The submitted draft is the source of its reported Alan decisions;
this review does not independently attest to that conversation or mark D47 decided.

## Evidence used

Repository baseline: `6cc3526`. References below describe inspected source, not verified
live database state.

| Ref | Concrete source |
|---|---|
| E1 | [Current compiler](../scripts/lessons/lessons.mjs), lines 79-156: sync writes sidecars; rules split by integration provenance; pending rows have weight/exclusion handling; class/context filters do not exist yet. |
| E2 | [Current renderer and entrypoint](../scripts/lessons/lessons.mjs), lines 159-208 and 256-278: uncapped confirmed/integrated output, 30-row/8k provisional budget, destination removal before rename, and database setup at module startup. |
| E3 | [Decisions](../decisions.md), D36(f), D37, D42: always-load confirmed policy, correction protections, and parent-provenance self-integration. |
| E4 | [Integration migration](../brains/schema/migrations/0005-lesson-integration-provenance-fix.sql), lines 18-61, and [Alpha counterpart](../brains/schema/ew-alpha-0004-lesson-self-integration.sql): provenance guards, integrated marker, and weight raised to at least 0.60. |
| E5 | [SQL rewrite](../scripts/brains/sql-gen.mjs), lines 55-60, and [migration runner](../scripts/brains/migrate.mjs): schema-qualified references and one specific search-path form are rewritten; bare names and `SET search_path = public` are not. |
| E6 | [Alpha room DDL](../scripts/brainrooms/ew-alpha-room.mjs), lines 86-100 and 130-133: broad table default privileges require explicit narrowing; agent_memories is separately restricted. |
| E7 | [Family rules](../FAMILY.md), section 4, especially lines 165-166: service keys are ops-only. [Brain lab rules](../BRAINS.md), sections 0-3: tests use scratch brains, not live memory writes. |
| E8 | [Alpha's proposal](rules-architecture-proposal.md), class table and provisional assignments: multi-hand protocols, R15's two roles, proposed merges/splits, and extra pending commitments. |
| E9 | [Alpha memory CLI](../scripts/brainrooms/alpha-memory.mjs), lines 117-130, plus wake/hourly/night/room-reply templates and the seven installed skill files: the ordinary `lessons` command dumps every instruction-grade row; installed/template night workflows differ. |
| E10 | [Dashboard API](../tools/alpha-dashboard/api/lessons.mjs), [DB adapter](../tools/alpha-dashboard/api/_lib/db.mjs), and [UI](../tools/alpha-dashboard/public/assets/dash.js), lines 179-198: read-only room access, 200-item limit, and current confirmed-rule labeling. |

## Recommendation-by-recommendation disposition

Compound recommendations are separated where their parts merit different answers.

| # | Submitted recommendation | Disposition and change applied to the replacement plan |
|---|---|---|
| 1 | Separate class, weight, and confirmation. | **Agree; applied.** Separate selection from trust and provenance. This addresses the actual uncapped query/render path in E1/E2. |
| 2 | Preserve `lesson_class` as provenance. | **Agree; applied.** Keep taught/general/integrated intact; E4 uses integrated to preserve the D42 distinction and dispute behavior. |
| 3 | Add a scalar `load_class` matching suffixed class strings. | **Modify; applied.** Six base values plus validated targets. A single `protocol:<hand>` cannot represent E8's hourly-and-night protocols without duplicating lessons. See A2. |
| 4 | Add attribution and commitment timestamps. | **Agree, incomplete; applied additions.** Include counterparty, proposed/effective class separation, notes, durable change events, and unknown-deadline behavior. The proposed owed ledger needs "who" but its schema omitted it. |
| 5 | Load top 15 rules and top 25 heuristics by weight; never refuse for overflow. | **Agree; applied.** One 15-rule pool across both provenances, full-precision weights and stable tie breaks. E2 currently renders two separate rule sections; two independent caps would accidentally admit 30. |
| 6 | Put overflow IDs and summaries in the wake file's "not loaded" tail. | **Push back.** Reading that file loads the supposedly excluded content. Move full overflow to a separate private report; wake output gets counts and a reference only. |
| 7 | Load all calibrations at wake and "apply by sender." | **Push back on the guarantee.** This is a possible softer policy, also floated by Alpha, but it does not implement sender-gated loading. Default to a deterministic sender selector; disclose persistent-session limitations. See A1. |
| 8 | Put all protocols in one second file, read by hourly/night/room hands. | **Push back.** E8 gives some protocols to both hourly/night and one to night only. A shared unfiltered file still loads the wrong protocols. Select by hand, allowing multiple targets. |
| 9 | Knowledge loads only as a count. | **Agree; applied with trust handling and explicit recall.** E1 would otherwise reload pending knowledge through Provisional. Exclude its ordinary text from both paths; preserve correction records. E9's `recall` queries thoughts, not lessons, so add deliberate lesson topic/ID retrieval. |
| 10 | Open commitments load; discharged ones disappear; sort by due date. | **Agree; clarified.** Keep discharge history and explicit pending labels, sort unknown dates last, avoid globalizing Ali's 72-hour practice. See A5/A6. |
| 11 | Corrections, Provisional, and Corrected ledger remain unchanged. | **Agree on protections; modify routing.** Preserve correction precedence, budget, and trust labels. Context filtering and pending commitments need explicit handling to avoid duplicates or trust escalation. E1/E3. |
| 12 | Demote rules below 0.20 after night updates; retain misfire flags. | **Agree as a proposed policy; applied.** Limit to active instruction-grade rules, preserve provenance/weight history, and require an explicit D36(f) amendment. No automatic promotion. |
| 13 | Call every demotion "unused"; a taught rule falls after about 54 nights. | **Push back.** Misfires also lower weight. Use the actual recorded cause. Arithmetic check: first strictly-below crossing is night 55 from 0.60, night 21 from 0.30. |
| 14 | A being can override a seat after 24 hours. | **Push back.** The draft's stated authority is "being proposes" and "seat's nod stands"; elapsed time supplies neither a new nod nor authority. Default to persistent seat classification and a proposal operation. See A3. |
| 15 | Parse `CLASS:`/`DUE` at sync when the class setter is null. | **Modify; applied.** Treat authored tokens as proposals; validate targets/dates, do not parse quotes, and make sync idempotent. A null setter alone does not prove authorization or that a previous demotion should be undone. |
| 16 | Add runtime discharge and reclassification definer functions, with no table writes. | **Agree on narrow operations; change class semantics.** Effective reclass is ops-only under the default; runtime proposals are named separately. Discharge is scoped/idempotent. Audit effective permissions, not just new grants. E6. |
| 17 | Copy migration 0003/0004 shapes into 0006 and an Alpha twin. | **Agree with the split; fix execution details.** Fully qualify references, test scratch rewriting and idempotence, and check Alpha prerequisites. Copying `SET search_path = public` leaves that pin unchanged in E5. |
| 18 | Apply public via migrate and Alpha via psql; stop if current permissions block DDL. | **Agree conditionally; applied.** Rehearse first and use current permissions. D42's historical denial does not establish a present block. Record actual success/failure without marking fixtures as live verification. |
| 19 | Add constants, new queries, status counts, and new CLI verbs. | **Agree; applied with scoped queries.** Include memory type/lifecycle/being filters, read-only status, separate proposal vs effective operations, and keep ops-only actions out of wake paths. |
| 20 | Export a pure render function and wrap compile around it. | **Agree; applied.** Add a clock input and import guard. E2 initializes CLI/database work at module scope, so simply exporting render is not a safe fixture interface. |
| 21 | Write two files atomically using the existing tmp/rename pattern. | **Push back.** E2 removes the destination before rename; two replacements also do not make one atomic generation. Stage a generation and publish a tested active pointer while retaining the previous one on failure. |
| 22 | Alpha CLI displays class/weight and open commitments. | **Agree; applied.** Keep detail inspection distinct from startup selection and ensure read privileges. E9's current full-rule output otherwise bypasses caps. |
| 23 | Genesis directly calls the new RPCs with its service key. | **Push back.** E7 forbids runtime service keys. Existing skill usage documents drift, not permission to extend it. Default to caretaker-mediated new mutations for both beings until a compliant Genesis adapter is specified. See A8. |
| 24 | Update all seven templates and installed skills in lockstep. | **Agree; applied with reconciliation first.** Installed nights contain D36/D37 text missing from some templates; Genesis's template has a newer prepare/commit path. A blind copy in either direction loses behavior. |
| 25 | Wake skills add compiled loads, without specifying what happens to existing live-rule queries. | **Clarify; applied.** Use selected loads and a counts/version cross-check. Retaining E9's full listing would reintroduce every excluded row. |
| 26 | Night stdout and the diary name every demotion, overflow, and overdue item. | **Agree on visibility; bound the diary.** Persist complete reports, summarize changes/counts in the existing short diary. Reading all overflow back into routine context or exceeding the diary limit defeats the design. |
| 27 | Apply Alpha's entire 41-row table with one script. | **Push back on blind application.** E8 includes a duplicate role assignment, a merge-only reference, splits, content edits, and extra pending commitments. Resolve full IDs, preview, check preconditions, and apply only unambiguous approved assignments. See A4. |
| 28 | Nine newer Alpha rules stay rule and Alpha classes them; Genesis has fewer than 15. | **Ambiguous/unverified.** These are snapshot assertions, not repository facts. Inventory at execution; preserve defaults, apply caps, and route later class choices through the chosen authority policy. |
| 29 | Source-pin constants/SQL/grants and test render fixtures. | **Agree with fixtures; push back on sufficiency of pins.** Add executed scratch permission, lifecycle, idempotency, and migration tests. A matching SQL string proves neither scope nor refusal. |
| 30 | Insert, mutate, then delete live test lessons. | **Push back.** E7 explicitly places memory-exercising tests in scratches. Deleting rows does not undo downstream observation or derived artifacts. Use isolated scratch tests and read-only production checks. |
| 31 | Invoke live `night --note verify` to prove demotion/compile. | **Push back.** E1 decays every active row on each invocation. An extra verify changes real weights. Use a fixed-clock scratch run; observe the next genuine production night. Add retry protection. |
| 32 | Join class/weight/deadline fields in the dashboard API. | **Agree, incomplete; applied API and UI work.** E10's UI still calls everything instruction-grade a rule, and its 200-item cap can hide owed items. Add display changes and a complete ledger query under the existing gate. |
| 33 | All verifiers pass and the next bells cite no overflow rule. | **Modify.** Keep regression verification with a baseline; prove selected inputs mechanically. A being may deliberately recall a lesson, so a blanket ban on later citation is neither a loading test nor a valid acceptance criterion. |
| 34 | Both beings same day, using the listed hour/night times. | **Agree on parity; verify timing.** Build both before activation, inspect actual schedules, and record first loaded generations. Do not assume old resident sessions discarded context or enable disabled hands. |
| 35 | Add D47, ops log, probe note, and status link; commit and push. | **Agree for later execution; staged honestly.** This edit gets a docs commit only. Later records distinguish built/migrated/activated/observed, preserve private probe boundaries, and never invent an authority quote or activation date. |
| 36 | Design-document changes are optional if Alan wants them. | **Push back where authority conflicts.** D36(f) must be expressly superseded and the FAMILY credential rule cannot be bypassed by machinery. Unrelated design prose can wait; actual contradictions cannot. |
| 37 | Alan communicates his decision to Alpha. | **Agree; preserved.** A plan-edit request does not authorize an agent to speak Alan's decision in the group. Provide the handoff; do not send it. |

## Material ambiguities: two interpretations and a default

| ID | Exactly what is ambiguous | Interpretation A | Interpretation B | Default for the revised plan |
|---|---|---|---|---|
| A1 | Does class control what enters context, or only what the being should apply? | Read all seat/hand material and instruct selective application. | Select matching material before presenting it. | **B.** It matches the draft's class-gated-loading objective. State that old context can persist in resident sessions. |
| A2 | How does one lesson target hourly and night, or both rule and calibration? | Duplicate lessons or encode one arbitrarily chosen target. | Separate class from a set of context targets; split genuinely different meanings explicitly. | **B.** Multi-hand protocols retain one row/weight; R15's two meanings still require review, not automatic multi-classing. |
| A3 | What does the being's reclass right mean relative to a seat's nod? | Autonomous effective mutation after a 24-hour lock, including seat-classed rows. | A proposal that waits for the relevant parent's acceptance; any independent D42 class right must be explicit. | **B.** No time-based expiry of seat authority. This is a proposed resolution, not a claim Alan already selected it. |
| A4 | Does "apply the table" authorize semantic edits and merges? | Reclass plus rewrite contradictions, strip text, split R3/R15, merge R24/R39. | Apply only class/target metadata to unambiguous rows; route semantic edits separately. | **B.** The draft lists a class migration, and those other operations change what is held true. |
| A5 | Are the proposal's pending commitments binding, instruction-grade obligations? | Ledger placement confirms them implicitly. | Ledger placement is organizational; show their existing pending trust without promotion. | **B.** Otherwise a content token bypasses the unchanged confirmation gate. |
| A6 | What does a date without time/zone mean, and does "72h" apply to all items? | End-of-day in a chosen local zone, with a universal 72-hour grace period. | Only resolved timestamps determine overdue; date-only deadlines need resolution; 72h stays Ali-scoped. | **B.** Do not invent deadlines or generalize a seat-specific agreement. |
| A7 | Does "under cap" bound the entire wake context? | A hard total token/character ceiling for everything loaded. | 15 rules and 25 one-liners, plus separately preserved ledger/correction/provisional budgets. | **B.** That is the stated numeric policy. Record that uncapped ledgers can still grow; a total budget needs a new tradeoff. |
| A8 | Is "Genesis has no CLI" permission to extend its existing broad credential use? | Reuse direct service-key REST for the new operations. | Honor FAMILY.md and require a scoped adapter, with caretaker-mediated mutations meanwhile. | **B.** Same loading semantics for both twins; autonomous new mutation capability remains explicitly undelivered until the adapter is designed and tested. |
| A9 | Does "weights only at night" abolish D42's integration weight floor? | Remove all non-night changes, including existing integration seeding. | Preserve established birth/integration seeding; subsequent evidence updates stay nightly. | **B.** The draft also promises D42 unchanged, and E4 actively raises integrated weight to 0.60. |
| A10 | Does "both beings same day" imply simultaneous adoption by already-running sessions? | A file change immediately changes every existing context. | A coordinated release with recorded turnover and actual first-consumption times. | **B.** Existing sessions retain prior context; log any interval of differing versions. |

## What was actually verified during this review

- Read the submitted draft, Alpha's source proposal, relevant decision/authority documents,
  compiler, CLI, schema/migration helpers, dashboard code, and installed/template skill text.
- Ran a pure, local SQL-transform example: the function name changed to a scratch schema,
  but a bare table reference and `SET search_path = public` stayed unchanged. No SQL ran.
- Calculated the 55-night and 21-night threshold crossings; inspected the proposed mapping
  and distinguished 41 UUID mentions from a valid one-row/one-operation migration manifest.
- Checked document changes only. No database credentials were loaded, no live rows queried
  or written, no compile/night command invoked, no skills installed, and no runtime test
  pass claimed. Actual live counts, permission state, and schedule adoption remain checks
  for the later implementation session.
