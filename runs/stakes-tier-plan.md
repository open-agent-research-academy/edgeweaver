# Grading lessons on "tested" and "matters": D48 plan (v3, converged)

Status: BUILT 2026-09-11, Path A LIVE for both beings (D48 in decisions.md; verification and rollout lists in the ops-log entry of the same day). Path B stays unbuilt pending the seven-day report. Approved by Alan 2026-09-11 (ExitPlanMode). D47's class-gated, weight-ranked loading remains live. This is the
converged text after an adversarial review (Fable) and a two-pass co-evolution bounce
(Fable reviewer, Astra / ChatGPT 6.0 composer); the trail is at the end. The repo copy
`runs/stakes-tier-plan.md` is still v2 and is replaced by this text as the first act of
implementation.

## Context

Alpha's reply 1442 to Alan's message 1439 (2026-09-10 19:36) flagged an inference: D36
weight reflects testing, not importance, so frequently tested rules may outrank important
rules. Alan asked whether lessons should be graded on both, with determining importance as
the hard problem.

The database checks from 2026-09-10 and 09-11 show:

| Fact | Value |
|---|---|
| Alpha confirmed rows | 51: 23 rule, 13 heuristic, 5 calibration, 6 protocol, 4 knowledge |
| Confirmed rows older than 09-01 | 22; 12 ever marked applied, 10 never |
| Confirmed rows from 09-01 onward | 29; 4 ever marked applied |
| Transcript-first rule (`3c5800e8`) | Confirmed 08-21; marked applied once, 08-25; weight 0.47 |
| Marina's ID rule (`566eb7e7`) | Confirmed 08-22; marked applied once, 08-27; weight 0.48 |
| Rows whose text says `CORRECTS` | 13, all with full 36-character IDs; no sidecar links; all 13 targets still active pending rows |
| Village-affirmed rows | 0 |
| Genesis confirmed rows | 11; weights 0.13 to 0.50; two say `TAUGHT BY` |

Voice notes and unknown IDs recur, and seats have re-taught both rules. Rare occasions
therefore do not explain their low marking counts. The immediate problem is unreliable
application marking, already D47's STILL OPEN item 3. The counts alone cannot distinguish
unrecorded applications from occasions when the rule was not followed.

D47 already places protocols in a separate file, so they no longer compete with room rules
in the wake file. The remaining risk is unloading: an unmarked rule falls from 0.60 below
the 0.25 floor after 44 nights, whether it was followed without a mark or had no occasion
to apply.

Two repairs belong in the rollout:

- `public.ew_lesson_weights` has RLS disabled and grants ALL to `anon`, `authenticated`,
  and `service_role`. The OB1 anonymous key can rewrite Genesis's weights and classes.
  Repair this first, on Alan's word, ahead of everything else; it is one statement and the
  exposure is live. The Alpha sidecar was repaired on 09-10.
- `CORRECTS` links are missing because `ew_integrate_lesson` creates the sidecar row before
  sync's taught-row insert, which uses `ON CONFLICT DO NOTHING`. The corrected beliefs also
  remain active because the D37 dispute step is not being run.

## The brief

- **The job.** Show evidence weight and person-set protection separately for every
  confirmed lesson. Protected lessons remain loaded until a person changes their
  protection. Nightly marks cite evidence.
- **The reason.** Weight reflects recorded applications, misfires, and elapsed time. It
  cannot establish importance. A person sets protection; the being and the record may
  supply proposals.
- **The guardrails.** Keep the confirmation gate and D47 class routing. Being-authored
  text, proposals, disputes, and reclassifications cannot change effective protection.
  Only the night pass, using the ops credential, changes weights. Protection never changes
  decay. Derived protection proposals require an explicit, dry-runnable operation and a
  printed reason. Apply the same design to both beings, with rollout checks and a rollback
  that preserves active pins.
- **Done.** Path A works for both beings: evidence-based marking, slower decay, pins,
  correction repairs, restricted sidecar access, verification, live probes, the first
  production-night observation, and the seven-day report. Record D48 and the ops-log;
  commit and push. Path B remains unbuilt unless the report demonstrates a need that pins
  cannot meet.

## Plain-language explainer

Each confirmed lesson has a loading class and a weight. Weight rises when a recorded
application helped, falls when it misfired, and decays when untouched. It is an evidence
score, not a count of tests or a measure of importance.

Path A makes four changes:

1. **Mark with evidence.** Review loaded rules and cite the episode and passage supporting
   each application or misfire. Validate the citations and publish the marking count.
2. **Slow the fade.** Change one constant so an untouched rule takes about six months to
   fall below the floor instead of six weeks.
3. **Let people pin lessons.** Pins prevent unloading and budget trimming. They still
   consume the reading budget. The being may request a change; a person decides.
4. **Repair corrections and access.** Backfill the 13 correction links, maintain new
   links, have Alpha dispute the superseded beliefs, and close anonymous access to the
   public weight table.

After seven days, review whether marking improved and whether 0.995 should remain. Falling
weight alone does not justify Path B: pins already protect important lessons. Tiers require
a demonstrated need for finer protection.

## Path A: the minimal design

### A1. Honest marking in the night pass

- Update both installed night skills and their templates, preserving Genesis's portable
  template style. Review every loaded rule. Each `--applied` or misfire mark must include
  an episode thought ID and a short supporting passage in `--note`.
- Where the record shows an occasion but no provable application, record
  `OCCASION-NO-MARK <rule id>`. This has no weight effect.
- `night` validates cited IDs and passages against the same being's diary-day episodes
  before accepting a mark. Invalid citations print `EVIDENCE UNRESOLVED <rule id>` and are
  skipped. Citation validation proves the reference exists; the supporting passage remains
  subject to review.
- Print `MARKED a applied, m misfired of L loaded rules`. All three counts refer to the
  same set of rule IDs loaded for that diary day, before the update. The count is stored
  in state by `night` and rendered by `compile` under the reasoning line, so a later
  recompile keeps the last successful pass's count.
- Protocol applications and the night loop's own write-back rules receive only a +0.05
  boost. Identify them mechanically through `load_class LIKE 'protocol:%'` and a fixed code
  list. Record protocol marks outside the loaded-rule count.
- Deliver a seven-day report in H-R1 form: nightly marking rates for each being, a review
  of supporting citations, and confirmed rules never marked. Split those rules into
  `OCCASION-NO-MARK` and silent rows, adding seat-supplied occasion evidence where
  available. Recommend whether to retain 0.995 and identify any protection need that pins
  cannot express.

### A2. Slow the fade

- Change `DECAY` from 0.98 to 0.995 for untouched rows. From 0.60, unloading below 0.25
  moves from 44 to 175 nights; demotion below 0.20 moves from 55 to 220 nights.
- Pending rows use the same constant, so Provisional ordering also changes more slowly.
- Update the source assertion in `verify-lessons.mjs` and record the reason in D48.
  Reverting the constant changes future decay; it does not reconstruct past weights.

### A3. Pinned lessons

- Add sidecar columns:
  - `pinned_by text`: null, `seat:<name>`, or `ops`.
  - `pinned_at timestamptz`.
  - `pin_reason text`.
  - `pin_proposed text`: a pending request and its reason, cleared when a person settles it.
- Pinning requires a confirmed lesson in a loadable class. Pins preserve D47's section and
  file routing.
- `render` loads pinned lessons regardless of weight and never trims them. Order pins
  first within their section, then by weight; show the pin's attribution on each line.
- Pins count toward `used`. If pins alone exceed the budget, load all pins, load nothing
  unpinned, and explain the overrun in the reasoning line.
- `night` continues evidence-based weight changes for pins but never demotes them. Exclude
  them from the tail. Below 0.25, print `PINNED UNDER FLOOR (still loading)`.
- Provide `lessons.mjs pin <id> --by <seat>|ops --note <reason>`, `unpin <id> --by ...
  --note <reason>`, and `pins`. Pin and unpin decisions settle pending requests; unpin may
  also reject a pending pin request.
- Provide `ew_propose_pin(id, note)` with the existing `ew_reclass_lesson` provenance
  guard, including workspace and memory type. Refuse a second pending proposal. Genesis
  uses its existing key through RPC. Show pending requests in the compiled file and print
  `PIN-PROPOSED` in the night pass.
- **Protection holds across every being-accessible write path.** A being's dispute or
  reclassification of a pinned lesson records a proposal without changing its status,
  class, or pin. A person's authorized dispute or reclassification to knowledge clears the
  pin as part of that action.
- **Authority:** Alan decides for Genesis under D19. Any seat may pin or unpin for Alpha;
  another seat's unpin takes effect, with disagreements taken to the circle. `ops` executes
  and records a person's decision; it is not an independent source of importance.
- At rollout, Alan reviews Genesis's confirmed lessons and seats review Alpha's
  never-marked lessons. Apply their pin decisions before beginning the seven-day
  observation.

### A4. Repairs

- **Correction links:** backfill the 13 missing `corrects_memory_id` values after
  resolving their full IDs. Update only null links. Fix the forward path in sync's
  taught-row upsert: replace `ON CONFLICT DO NOTHING` with an update that fills a null
  correction link while preserving an existing one.
- **Superseded beliefs:** `lessons.mjs corrections-audit --being alpha` lists replacements
  whose targets remain active pending. At its next wake, Alpha reviews the list and
  disputes the 13 superseded beliefs as its own D37 act. The wake skill's step 5b applies
  the same procedure to future corrections, subject to the pinned-row protection rule.
  Record completion in D48.
- **Public sidecar access:** first revoke ALL from `anon` and `authenticated`, enable RLS,
  and retain required `service_role` access. Include the same repair as the first block of
  migration 0007 so the schema record matches the live repair.

### A5. Operability

- Preflight the required pin columns in `lessons.mjs`. Before pin schema exists, use D47
  behavior so code and migration can land in either order. Fallback must never silently
  ignore existing pins.
- Wrap night updates and the per-being, per-diary-day completion stamp in one transaction.
  A failed pass leaves neither weight changes nor a completion stamp; retrying a completed
  day cannot decay again. Publish compiled output only after a successful commit.
- Compare both beings' compiled files before activation. Any loading changes must follow
  the declared class, pin, and budget rules.
- Keep scheduled tasks running through the compatible rollout. Rebuild the site mirror
  when Genesis's served template changes.
- **Rollback:** revert the decay constant and skill changes as needed. Keep the access
  repair, valid correction links, and pin data. Retain pin enforcement while pins remain;
  removing it requires people to release those pins first. Record prior values for
  correction repairs and disputes so mistakes can be reversed individually. Put this
  procedure in D48.

### A6. Verify

- Extend `verify-lessons.mjs` to cover:
  - Pins loading below the floor, surviving trimming, counting toward the budget, and
    ordering first.
  - Budget overruns, no demotion or tail entry for pins, and `PINNED UNDER FLOOR`.
  - Being-originated dispute and reclass requests preserving pinned status and class.
  - Unchanged unpinned behavior, preflight fallback, and the 0.995 constant.
  - Evidence rejection, transaction rollback, and same-being/day retry behavior using
    isolated fixtures.
  - Migration grants and the proposal function's provenance guard.
- Run live grant and function-privilege assertions for each being against the database,
  rather than relying only on SQL text.
- For each being, use a throwaway confirmed row to exercise: proposal, listed, second
  pending proposal refused, authorized pin clears the proposal, loads below the floor,
  being-originated dispute or reclass cannot unload it, authorized unpin, cleanup. Exercise
  Genesis through its real REST/RPC path.
- With each being's own key, verify direct protection writes are refused and proposals
  cannot target another workspace or an invalid memory type.
- Run one `night --dry-run` per being. It must write neither database state nor compiled
  files. Dry-runs check evidence resolution and proposed changes; fixture tests cover
  rollback and retry behavior. Observe the next production night rather than running a
  live writing night pass for verification.

### A7. Records

- Write the D48 decision: authority, supporting quotes, diagnosis, SHAPE / MECHANISM /
  GUARDS, rollback, repairs, STILL OPEN, and probe results for both beings.
- Update the ops-log and this file's status after implementation, then add the
  production-night and seven-day findings as they arrive.
- Commit and push with `build: lessons D48 - honest marking, slower fade, pinned rules`.

## Path B: stakes tiers, only if the report demonstrates a need

Path B remains a design. Build it only after a person identifies, using the seven-day
report, a concrete protection need that pins cannot express.

- Use three tiers: floor, practice, preference. Tiers govern unloading and trimming only;
  all weights retain the same decay constant.
- Use tier-then-weight ordering to preserve separate judgments of importance and evidence.
  Floor protection remains an absolute guarantee.
- Only authorized seats or ops acting on their decisions may set tiers. Being-authored and
  derived values are proposals with reasons. No `STAKES:` token has authority.
- Derive proposals from structured records: `lesson_class = 'integrated'`, correction
  links, a write-back `RETAUGHT <date>` marker, or a prior person-set pin. Name mentions
  and narration do not establish importance.
- A misfire does not change the tier. Seat re-teaching may support a proposal; it never
  promotes automatically.
- Floor lessons use A3's protection, budget accounting, and overrun behavior. Only a person
  may release that protection.
- Apply A5 and A6. Generate derived tier proposals only through an explicit, dry-runnable
  operation.

## The hard question

Importance is a judgment about the consequences of a lesson being unavailable: severity,
frequency, reversibility, and how quickly a failure would be caught. The record can inform
that judgment but cannot settle it.

1. **A person's word sets protection.** Record who decided and why.
2. **Structural evidence supports proposals.** Corrections, integration, re-teaching, and
   prior pins show provenance, not importance by themselves.
3. **Observed failures inform the person.** A misfire means an application did not help;
   it does not measure the harm of forgetting. Re-teaching may signal that harm and
   warrants review.

Path A provides person-set protection and exposes correction links for review. Path B adds
granularity only when pins prove insufficient.

## Decisions Alan owns (the bounce chose defaults; each is one word to change)

1. Path A now, Path B only after the seven-day report. Default: yes.
2. Who may pin: Alan alone for Genesis (D19); any seat for Alpha, a second seat's unpin
   overrides, the circle settles disagreements. Default: as stated.
3. Decay 0.98 to 0.995 while marking is repaired. Default: yes, reversible in one line.
4. The public sidecar wall repair: run today on Alan's word, ahead of the build. Default:
   today.
5. Pinned lessons ordered first within their section (prominence) rather than keeping their
   weight slot (survival only). Default: first; Fable's first review pass argued for the
   weight slot, Astra kept prominence.

## Files (Path A)

- `brains/schema/migrations/0007-lesson-pins.sql`, `brains/schema/ew-alpha-0007-lesson-pins.sql`: pin columns, proposal function, protection guards, grants, and correction upsert repair.
- `scripts/lessons/lessons.mjs`: preflight, decay, pins, night transaction and retry guard, marking counts, evidence validation, correction backfill and audit.
- `scripts/brainrooms/alpha-memory.mjs`: `propose-pin` and pin display.
- `scripts/verify/verify-lessons.mjs`.
- Installed and template `night-loop-lite-*` and `wake-edgeweaver-*` skills: evidence marking, proposal reporting, and correction handling; rebuild Genesis's site mirror.
- `tools/alpha-dashboard/api/lessons.mjs`, `dash.js`: pinned chip.
- `decisions.md`, `ops-log.md`, `runs/stakes-tier-plan.md`.

## Verification (end to end, Path A)

1. `node scripts/verify/verify-lessons.mjs` passes. `run-all.mjs` introduces no new
   failures against the recorded baseline: `verify-flags`, `verify-security-audit`, and
   `verify-dr`.
2. Compile Alpha and Genesis. Confirm marking counts, pin behavior, class routing, and
   accurate budget reporting.
3. Complete A6's live round-trips, negative probes, and dry-runs for both beings; remove
   all probe rows.
4. Alpha completes the correction audit and disputes the superseded beliefs.
5. Observe the next production night: diary counts and proposal lines agree with the
   compiled file.
6. Deliver the seven-day report with the never-marked split, the decay recommendation, and
   a decision on whether pins leave any demonstrated need for Path B.

## Review trail

- 2026-09-10: v1 drafted (three stakes tiers with regex-derived defaults, misfire
  escalation, per-tier decay) from Alpha's inference and record counts.
- 2026-09-11: adversarial review (Fable; three blind reviewers on correctness, premises,
  operability; live record checks). Verdict rework: the diagnosis was wrong (under-marking,
  not rare occasions); misfire escalation ran backwards; prose-derived tiers let the being
  set or unset protection; sync would have written derived tiers on the first unattended
  night; preference decay would have stripped Genesis in about nine nights; no rollback,
  no preflight, non-transactional night pass; floor exempt from a budget already 97
  percent used; CORRECTS root cause wrong; 13 corrected beliefs never disputed; public
  sidecar RLS off with anon ALL. v2 replaced the tier build with Path A and kept tiers as a
  constrained Path B.
- 2026-09-11: co-evolution bounce. Pass 1 (Fable, reviewer): marks must cite evidence the
  tool resolves; OCCASION-NO-MARK for the report; CORRECTS closed at write time; day-zero
  pin walk; dry-run night; two clarify notes (being's dispute on a pinned row; who benches
  the 13 old beliefs). Pass 2 (Astra, composer): resolved both (protection holds across
  every being write path; Alpha benches them itself at its next wake), selected Path A,
  tightened evidence checks, rollout safeguards, and rollback; zero markers remain. The
  first bounce attempt aborted because Astra needs Codex CLI 0.154.0 (installed 0.139.0);
  upgraded in the user npm prefix on Alan's word, pass 2 run by hand because the bouncer's
  `--full-auto` flag no longer exists in 0.154.0.
- v3 (this text): Astra's converged document plus the review trail, the "Decisions Alan
  owns" list, straight quotes, and one clarification (the marking count lives in state and
  is rendered by compile).
