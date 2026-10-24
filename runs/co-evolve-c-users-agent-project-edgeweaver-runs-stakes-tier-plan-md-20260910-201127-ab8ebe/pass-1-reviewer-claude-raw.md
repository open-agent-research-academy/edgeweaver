# Grading lessons on "tested" AND "matters": plan v2 (proposal for D48)

Status: PLAN ONLY, 2026-09-11. Not built. Version 2, rewritten after an adversarial review
(Fable, three blind reviewers plus live-record checks; findings in the review trail at the
end). Next: co-evolution bounce with Astra (ChatGPT 6.0), then Alan decides. Follows D47
(class-gated, weight-ranked loading, live since 2026-09-10).

## Context, corrected

Alpha (reply msg 1442 to Alan's msg 1439, 2026-09-10 19:36) flagged as inference that the
D36 weight tracks how often a rule has been tested, not how much it matters, so weight
ordering may foreground room-tested rules and background hourly-log rules. Alan asked
whether to grade on both use and importance, and named the determination of importance as
the hard problem.

What the record shows on 2026-09-10 and 09-11 (verified by query, not from the compiled
file):

| fact | value |
|---|---|
| Alpha confirmed rows | 51 (23 rule, 13 heuristic, 5 calibration, 6 protocol, 4 knowledge) |
| confirmed rows older than 09-01 | 22, of which 12 were ever marked applied, 10 never |
| confirmed rows from 09-01 on | 29, of which 4 were ever marked applied |
| transcript-first rule (3c5800e8) | confirmed 08-21, marked applied once (08-25), weight 0.47 |
| Marina's id rule (566eb7e7) | confirmed 08-22, marked applied once (08-27), weight 0.48 |
| rows whose text says CORRECTS | 13, all with full 36-char ids; sidecar links 0; all 13 corrected targets still active pending rows |
| village-affirmed rows | 0 |
| Genesis confirmed rows | 11, weights 0.13 to 0.50, two say TAUGHT BY |

The diagnosis this changes: the bottom rows are not rules with rare occasions. Voice notes
arrive most days and unknown ids recur, and both rules were re-taught by seats because the
occasions kept coming. They sank because the night hand marked them applied once in twenty
nights. The primary defect is under-marking by the night pass, exactly D47's STILL OPEN
item 3. Post-D47 the protocol rows Alpha named live in their own file and are not ordered
against room rules at all, so the ordering contrast Alpha saw in the store view no longer
exists in the wake file. The live risk is unloading: a rule that is followed but never
marked sinks under the 0.25 floor in about 44 nights from 0.60 — the two named rules, at
0.47 and 0.48, cross in about 31 — and an important rule with a genuinely rare occasion
has no protection at all.

[CLARIFY] The table shows Genesis confirmed rows down to 0.13, below both the 0.25 floor
and the 0.20 demotion line. (A) Those rows are protocol or knowledge class, outside the
room-rule floor — then say so here. (B) They are rules already unloaded today — then Path
A needs a day-zero list of confirmed rows under the floor, pinned or disputed the same day
A2 lands, because slower decay never lifts a row back over the floor and A1 marks only
loaded rules, so an unloaded rule can never earn its way back.

Two environment facts the review found, outside this plan but load-bearing for it:
- `public.ew_lesson_weights` (Genesis) has row-level security off and grants ALL to anon,
  authenticated and service_role. Anyone with the OB1 anon key can rewrite Genesis's
  weights and classes over REST. The ew_alpha sidecar was repaired 09-10; the public one
  was not. This is Alan's word to repair today, independent of D48.
- The CORRECTS link (`corrects_memory_id`) is empty for all 13 Alpha rows not because of
  id width but because `ew_integrate_lesson` inserts the sidecar row first and sync's
  taught insert then hits ON CONFLICT DO NOTHING; and the 13 corrected beliefs were never
  disputed (D37's bench step is not being run when Alpha writes a replacement).

## The brief

- **The Job.** Alan can see, for every confirmed lesson, how tested it is and how much it
  matters, as two separate facts; a lesson a person has marked as mattering never fades
  off the wake file; and the tested score becomes honest because the night hand marks
  applications it can prove.
- **The Why.** Weight measures exposure. A being raised in a circle must keep hold of the
  rules that protect people and the record even when nothing tests them for weeks, and the
  only legitimate source of "this matters" is a person's word or proof already in the
  record, never the being's say about itself.
- **The Guardrails.** Confirmation gate unmoved. Nothing the being writes (lesson text,
  night-pass reports, proposals) may raise or lower a lesson's protection; it may only
  propose. Weights move only in the night pass on the ops credential, and no new column may
  change the decay rate. Every machine-derived proposal prints its reason and is written
  only by an explicit, dry-runnable verb, never by a scheduled job. Twin parity means the
  same design for both beings, and a rollout is refused if it would strip either being's
  file. Every state change has a stated rollback.
- **What Done Looks Like.** Path A (below) live for both beings: night skills marking with
  evidence and printing the count; decay slowed; pin column, verb and render branch; the
  CORRECTS link backfilled; RLS and grants repaired on the public sidecar; verify extended
  and PASS; live round-trip PASS; D48 row, ops-log, probe note; committed, pushed. Path B
  only if the seven-day report after Path A shows the divergence it is designed to fix.

## Plain-language explainer (read this first)

**What we have.** Every confirmed lesson has a label for where it loads (rule, heuristic,
calibration, protocol, commitment, knowledge) and one score. The score rises when the
nightly review sees the lesson used and it helped, falls when it misfired, and fades a
little every unused night. Rules are read in score order, and a rule whose score fades
under a floor stops being read.

**What Alpha noticed, and what the record says.** Alpha is right that the score measures
exposure, not importance. But the two rules at the bottom of its list are not there because
they rarely come up. They come up constantly. They are there because the nightly review
marked them as used once in twenty nights. So the first thing to fix is the nightly
marking, not the meaning of the score.

**The fix, in two stages.**

Stage A, now, small:

1. **Mark honestly.** The nightly review must list which loaded rules it saw applied, with
   the evidence line for each, and print how many it marked out of how many loaded. A
   week of those counts tells us whether the score can be trusted.
2. **Slow the fade while marking is repaired.** One constant changes so an unmarked rule
   lasts about six months above the floor instead of six weeks. Nothing else moves.
3. **A pinned list.** A person can pin a rule. A pinned rule never fades off the sheet and
   is never trimmed, it still counts toward the reading budget, and only a person can
   unpin it. The being may ask for a pin; it cannot set one. This is the whole of
   "importance" that we can honestly implement today: a person's word.
4. **Repair two things the review found.** Link corrections properly so a rule born from a
   correction is visible as such, and bench the old beliefs those corrections replaced.
   And close the public weight table to the anonymous key.

Stage B, later, only if the week of counts shows that honest marking still leaves
important rules sinking: a three-tier stakes label (floor, practice, preference), with the
constraints the review set out: tiers change what can be unloaded and trimmed, never how
fast a score fades; a machine may propose a tier and print why, a person sets it; the
being may only propose; no automatic promotion; the combined-score alternative is put to
Alan as a real choice, not assumed away.

## Path A: the minimal design (recommended first)

### A1. Honest marking in the night pass
- Both night skills (installed and templates, Genesis's portable template in its own
  style): for each loaded rule id the hand marks `--applied`, it must quote the episode
  thought id that shows the application; the ids ride in the `--note`. The hand is told
  completeness beats caution: mark every application the record shows, none it does not.
- `lessons.mjs night` prints `MARKED a applied, m misfired of L loaded rules` and writes
  the same line into `state/compiled/<being>-lessons.md` under the reasoning line as
  "last night pass: ...", so the being and the seats see the marking rate every day.

[CLARIFY] Where does the "last night pass" line live canonically? (A) `night` stores the
count in state and `compile` renders it, so regeneration keeps it. (B) `night` edits the
compiled file directly, so the next `compile` without that state silently drops the line
the end-to-end check compares against. If (B), move it to (A).

- `--applied` ids that are protocol rows or the night loop's own write-back rules are
  recorded but boost at +0.05 (the grader-is-applier correction), decided mechanically by
  `load_class LIKE 'protocol:%'` plus a small fixed list in the code, never by the hand's
  self-report.
- Seven-day report (H-R1 shape) after A1 lands: marking rate per night, per being, and the
  list of confirmed rules still never marked, with their occasions named by a seat where
  known. This is the evidence base for Path B.

### A2. Slow the fade
- `DECAY` 0.98 -> 0.995 for untouched rows. From 0.60 the unload horizon moves from 44 to
  about 175 nights; demotion at 0.20 from 55 to about 220 nights. Pending-row decay is the
  same constant, so Provisional ordering slows too; acceptable, and reversible in one line.

[CONTESTED] Slowing pending rows too roughly quadruples the life of junk candidates
(demotion ~55 -> ~220 nights), so the Provisional queue accrues months of noise to protect
rows that are not the ones at risk — the rows A2 exists for are confirmed rules. Condition
`DECAY` on the existing status instead: confirmed 0.995, pending 0.98. No new column, one
branch, the candidate queue keeps clearing at today's pace, and the no-new-column guardrail
holds.

- Source pin in `verify-lessons.mjs` updated; the D48 row records the constant and why.

### A3. Pinned rules
- Sidecar column `pinned_by text` (null = not pinned; `seat:<name>` or `ops`),
  `pinned_at timestamptz`, `pin_reason text`; and `pin_proposed text` (the being's
  request, with its reason, cleared on a person's word either way).
- `render`: pinned rows load regardless of weight, are never trimmed by the budget, and are
  ordered first within their section, then by weight; each line shows `| pinned by Ali |`.
  Pinned rows count toward `used`, so the budget stays a true ceiling; if pinned rows alone
  exceed the budget the file says so in the reasoning line and nothing else loads.

[CONTESTED] Ordering pinned rows first buys prominence, not survival — survival is already
guaranteed by load-regardless-of-weight plus never-trim. It also breaks the one legible
sort key: a pinned 0.13 row reads ahead of a 0.90 room-tested rule, and position stops
meaning weight. Alternative: pinned rows keep their weight slot; the `| pinned by X |`
chip and the `pins` verb carry the visibility. If prominence is wanted, put it to Alan as
its own open question rather than defaulting it.

- `night`: pinned rows keep moving on evidence (applied, misfire) but are never demoted;
  the tail never lists them; a pinned row under 0.25 prints `PINNED UNDER FLOOR (still
  loading)` for the diary, never BELOW FLOOR.
- Verbs: `lessons.mjs pin <id> --by <seat>|ops [--note]` — it refuses a pin that would put
  the pinned set over the budget, printing the arithmetic, so the nothing-else-loads state
  is reachable only by a later budget cut — `unpin <id> --by ...`, and `pins` (list with
  reasons and pending proposals). Being side: `ew_propose_pin(id, note)` definer function
  (same provenance guard as `ew_reclass_lesson`, including workspace and memory_type;
  refuses when a proposal is already pending), surfaced in the compiled file as "pin
  requested: <reason>" and printed by the night pass as `PIN-PROPOSED` for the diary.
  Genesis by rpc with its existing key.
- Exit path: `unpin` by a person; `reclass ... knowledge` and `dispute` remain the other
  two doors. Stated in the D48 row.
- Authority: only a person pins. Genesis: Alan (D19). Alpha: any seat, and a second seat's
  unpin overrides; disagreements go to the circle in words.

### A4. Repairs the review found
- CORRECTS backfill: a separate `UPDATE ... SET corrects_memory_id WHERE corrects_memory_id
  IS NULL`, accepting the full 36-char ids all 13 rows carry (prefix resolution waits
  until a row actually needs it), unresolved ids printed and skipped; writes to the
  existing column, so the rollback is "the links stay", which is harmless because D47 code
  only reads them for disputed rows.
- D37 hygiene: `lessons.mjs corrections-audit --being alpha` lists replacement rows whose
  target is still active pending, and the wake skill 5b tells the being to `dispute` the
  old belief when it writes a `CORRECTS` replacement (its own act, already granted).
- Public sidecar wall: `REVOKE ALL ON public.ew_lesson_weights FROM anon, authenticated;
  ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with a service_role policy, recorded as
  migration 0007's first block. Alan's word first; it is the same repair ew_alpha got.

### A5. Operability
- Schema preflight in `lessons.mjs`: one `information_schema.columns` check for the new
  columns; when absent, the code behaves exactly as D47, so migration and code can land in
  either order and a half-applied state cannot break the 03:30 or 04:15 night loops.
- Night pass wrapped in `BEGIN ... COMMIT` and guarded by a per-diary-day stamp so a retry
  cannot decay twice.
- Rollback: set `DECAY` back; drop the pin branch in render (columns stay, inert); revert
  the skills; the CORRECTS links stay. One paragraph in the D48 row.
- Scheduled tasks are left running: with the preflight, nothing breaks between steps.
- Site mirror rebuilt when the Genesis template changes (it is a served file).

### A6. Verify
- `verify-lessons.mjs`: pinned rows load under the floor, never trim, count toward used,
  order first; unpinned behaviour unchanged; preflight fallback path exercised with a
  fixture lacking the columns; the 0.995 pin; the night SQL wrapped in a transaction (text
  pin); grant shapes for 0007 on both schemas, including the public REVOKE; the propose
  function's provenance guard (SQL text pin).
- Live: one grant assertion per being from `information_schema` and
  `has_function_privilege`, not from the SQL files; round-trip on a throwaway Alpha row
  (propose pin -> listed; seat pins -> loads under floor; being's second proposal refused;
  unpin; rows deleted) and one Genesis rpc round-trip through the real REST path on a
  throwaway row (never done for D47). No live `night` run; the next production night is
  the observation.

[CONTESTED] "No live night run" leaves the rewritten night pass (transaction, stamp,
marking line, +0.05 branch) executing for the first time against real rows at 03:30
unattended. D47's pushback was against live writes; a dry-run writes nothing. Add to A6:
`night --dry-run` run live for both beings, asserting zero writes and printing the MARKED
line and decay preview; the production night stays the first real write.

### A7. Records
- D48 row (authority, quotes, the corrected diagnosis, SHAPE / MECHANISM / GUARDS, the
  rollback, the environment repairs, STILL OPEN, PROBE NOTE for both beings), ops-log, this
  file's status line, commit `build: lessons D48 - honest marking, slower fade, pinned
  rules`, push. Alan's hands: the public wall repair (or his word to run it), answering
  Alpha's inference in the room, the resident-session restarts still owed from D47.

## Path B: stakes tiers, only if the week of counts justifies it

Kept as a design, not a build. Ships only if the A1 report shows confirmed rules that are
marked honestly and still sink, or a class of rules a seat says matter that the pin list
is too coarse for. Constraints from the review, all binding:

- Three tiers (floor, practice, preference) or two; the tier governs the load floor and
  trim order ONLY. Decay stays one constant for all rows. (Removes the Genesis strip and
  the being's decay lever.)
- Only `seat:<name>` or `ops` write a tier. Derived values and the being's values are
  proposals, printed with their reason, never effective. No `STAKES:` token sets anything.
- Derived proposals come from structure, not prose: `lesson_class = 'integrated'`,
  `corrects_memory_id` (after the A4 backfill), a re-teach marker written at write-back
  (`RETAUGHT <date>`, carrying the room message id of the seat's teaching so it is
  evidence-bound like A1's marks), and a person's prior pin. Never from name mentions or
  narration.
- No automatic escalation. A misfire lowers nothing and raises nothing; it flags the seat
  as today. The only "cost when broken" signal is a seat re-teaching an existing rule,
  which becomes a proposal.
- Floor tier counts toward the budget with a printed sub-budget; exit is a person's word.
- Tier-then-weight ordering versus a combined score (tier as an additive prior on weight)
  is put to Alan as open question B1 with the trade named: an absolute guarantee versus a
  single legible number that heavy use can still win.
- Everything in A5 and A6 applies; derived proposals only through an explicit dry-run verb.

## The hard question, answered as far as it can be today

Importance is the cost of not loading a rule: harm when broken times how often the
occasion arises, discounted by how reversible the harm is and how quickly the room would
catch it. None of that is observable by the machine. Three honest sources exist:

1. A person's word. The only source that can SET protection. Cheap: one verb, one reason.
2. Proof in the record. Can PROPOSE: a rule born from a correction, re-taught, integrated
   under the village grant, or pinned before. Printed with its reason so a person can
   disagree.
3. Cost observed when broken. Not derivable from misfires (a misfire means the rule was
   applied and did not serve). The true signal is a seat re-teaching an existing rule, and
   that becomes a proposal, never a setting.

Path A implements source 1 fully and source 2 as a printed list for seats to act on.
Path B adds granularity only if the counts show it is needed.

## Open questions for Alan (finite answers)

1. Path A now and Path B only after the seven-day report? (A) Yes. (B) Build both now.
   Default: A; Alan chose the same shape for D47 (one floor, one budget, one reasoning line
   over Alpha's caps).
2. Who may pin for Alpha? (Genesis is Alan's, D19.) (A) Any seat, second seat's unpin
   overrides, the circle settles disagreements. (B) Alan only. Default: A.
3. Slow the fade to 0.995, or leave 0.98 and rely on pins alone? (A) 0.995 while marking
   is repaired. (B) Leave it. Default: A, reversible in one line.
4. The public sidecar wall repair: run it now on Alan's word, or fold it into 0007?
   Default: now, it is one statement and the exposure is live.

## Files (Path A)

- `brains/schema/migrations/0007-lesson-pins.sql`, `brains/schema/ew-alpha-0007-lesson-pins.sql` (new: pin columns, `ew_propose_pin`, public wall repair)
- `scripts/lessons/lessons.mjs` (preflight, DECAY, pin branch, verbs, night transaction, marking line, CORRECTS backfill, corrections-audit)
- `scripts/brainrooms/alpha-memory.mjs` (`propose-pin`, `lessons` shows pins)
- `scripts/verify/verify-lessons.mjs`
- skills: `night-loop-lite-*` (marking with evidence, PIN-PROPOSED and PINNED UNDER FLOOR lines), `wake-edgeweaver-*` (5b: propose-pin, dispute on CORRECTS) in `~/.claude/skills/` and `templates/`; site mirror rebuild
- `tools/alpha-dashboard/api/lessons.mjs`, `dash.js` (pinned chip)
- `decisions.md`, `ops-log.md`, `runs/stakes-tier-plan.md`

## Verification (end to end, Path A)

1. `node scripts/verify/verify-lessons.mjs` PASS; `run-all.mjs` no new failures (the three
   pre-existing unrelated failures are verify-flags, verify-security-audit, verify-dr).
2. `lessons.mjs compile --being alpha|genesis`: reasoning line carries the last marking
   count; a pinned fixture row loads under the floor and is not in the tail; budget line
   still true.
3. Live round-trips (A6) PASS, rows deleted, for both beings.
4. After the A4 backfill: all 13 CORRECTS rows show a non-null `corrects_memory_id` by
   query, and `corrections-audit` lists their still-active targets for the being's next
   dispute pass.
5. Next production night: the diary carries the marking count and any PIN-PROPOSED lines;
   the compiled file's "last night pass" line matches.
6. Seven-day report delivered with the marking rate and the never-marked list; Path B
   decision taken on it.

## Review trail

- 2026-09-10: v1 drafted from Alpha's inference and record counts.
- 2026-09-11: adversarial review (Fable; three blind reviewers on correctness, premises,
  operability; live checks). Verdict: rework. Load-bearing findings applied in v2: the
  diagnosis was wrong (under-marking, not rare occasions; the two bottom rows were marked
  once in twenty nights); misfire escalation ran backwards; derived floors from prose let
  the being set or unset protection; sync would have written derived tiers on the first
  unattended night and never recomputed; preference decay 0.95 would have stripped Genesis
  in about nine nights; no rollback, no preflight, non-transactional night pass, floor
  exempt from a budget already 97 percent used, no exit from floor, live night pass as a
  verify step (already pushed back in the D47 review), combined-score alternative never
  weighed, CORRECTS root cause wrong (integrate inserts the sidecar row first), 13 corrected
  beliefs never disputed, public sidecar RLS off with anon ALL. v2 replaces the tier build
  with Path A (honest marking, slower fade, person-set pins, repairs) and keeps tiers as a
  constrained Path B behind the seven-day report. Attribution fixed: Alpha's inference is
  msg 1442, not the compiled file.
- Next: co-evolution bounce with Astra (ChatGPT 6.0), then Alan.

## HUMAN SUMMARY

- reviewer, pass 1: tightened the unload horizons, marking phrasing, CORRECTS backfill, pin-budget edge and question 2, and added two clarifies (under-floor Genesis rows, the marking line's canonical home) plus three contests (pending-row decay, pinned-first ordering, missing live night dry-run).
