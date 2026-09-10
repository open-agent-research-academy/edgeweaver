# Revised plan: lesson classes and weighted loading (proposed D47)

Status: planning revision for Alan to return to Law, 2026-09-09. No implementation,
database migration, reclassification, skill installation, or activation is authorized by
this document revision. The recommendation-by-recommendation assessment is in
[the accompanying review](lesson-classes-weighted-loading-review.md).

This replaces the attached draft titled "Plan: lesson classes + weighted loading (D47)"
for the next planning iteration. It does not replace the project's root PLAN.md or record
D47 as decided. Repository evidence was inspected at commit `6cc3526`, with pre-existing
uncommitted work left intact. Live lesson counts, grants, schedules, and Alan's reported
September 9 decisions have not been independently verified in this review.

## 1. Intended result and authority

Keep the draft's reported intent: class chooses the applicable context, existing weight
orders eligible lessons, the rule cap is 15, the heuristic cap is 25, overflow remains
visible to reviewers, and Genesis and Alpha receive the same loading policy in one
coordinated release. Exceeding a cap is normal selection, not a compile error.

Keep three independent dimensions: trust/lifecycle in `agent_memories`, provenance in
`ew_lesson_weights.lesson_class`, and loading class in new sidecar fields. Reclassification
must not confirm, integrate, dispute, reject, change provenance, or change weight.

The proposed D47 decision must explicitly supersede **D36(f)**, which currently says
confirmed lessons always load regardless of weight. It must also authorize threshold
demotion of an instruction-grade rule's loading class. Do not present either change as
already covered by D36. Preserve the D37 correction gate and the D42 parent-provenance
self-integration path, including its existing initial weight adjustment. "Weights move
only at night" describes subsequent evidence updates; it must not erase D42's existing
integration behavior.

Class authority defaults to the being proposing and the confirming seat accepting.
An effective seat classification does not expire after 24 hours. A later seat decision,
or the expressly authorized nightly demotion policy, may change it. Whether self-integrated
lessons also carry an independent right to choose their effective class remains a named
question for Law; default to a class proposal pending the appropriate parent's nod.

Identity remains in the being's own soul repository. Compiled files, audit events, and
classification manifests are operational material, stored under gitignored `state/` when
they contain lesson content. No messages are sent to the circle by the implementing agent
without Alan's explicit authorization.

## 2. Data and behavior

### Classes, targets, and trust

Add `load_class` with the six values `rule`, `heuristic`, `calibration`, `protocol`,
`commitment`, and `knowledge`, defaulting existing rows to `rule`. Store context separately
in `load_targets text[]`: exactly one allowed seat for a calibration, one or more allowed
hands for a protocol, and no targets for the other classes. This supports a single protocol
used by both hourly and night hands without duplicating its lesson or weight.

Use the current roster and explicit hand allowlists, not arbitrary strings. Initial hand
identifiers are `channel`, `hourly`, `night`, and `room-reply`. CLI conveniences may accept
`calibration:ali` and `protocol:hourly,night`, then normalize them. Database constraints and
operation validation enforce the same combinations. A Genesis calibration does not grant
that person parent authority over Genesis.

Add effective-class attribution (`class_set_by`, `class_set_at`, `class_note`), separate
proposed-class/target/note attribution, and commitment fields (`owed_to`, `due_at`,
`discharged_at`, `discharge_note`). Preserve unknown counterparties and deadlines as
unknown. Reclassifying a row must preserve its discharge history.

All new selection and mutation queries require the being's scope, `memory_type='lesson'`,
and the appropriate lifecycle. Genesis additionally requires `workspace_id='edgeweaver'`;
Alpha operations use its own schema. Do not rely on a UUID alone as authorization.

| Class | Routine context | Selection |
|---|---|---|
| Rule | Shared wake block | Active instruction-grade rows, 15 total across confirmed and self-integrated provenance. |
| Heuristic | Shared wake block | Active instruction-grade rows, 25 summaries, one normalized line each. |
| Calibration | Matching sender's reply context | Only that sender's scoped rows; no all-seat wake block. |
| Protocol | Matching hand | A protocol can target several hands; each receives it once. |
| Commitment | Shared owed ledger | Open active commitments, explicitly labeled by trust; discharged rows omitted. |
| Knowledge | Topic recall | No routine lesson text, whether pending or confirmed; counts only in the wake block. |

Apply context filtering before ranking and rendering. Pending rule/heuristic candidates
stay hypotheses under the existing 30-row/8,000-character Provisional limit; pending
calibration/protocol candidates can enter that same budget only in their matching context.
Pending commitments appear once, in an explicitly unconfirmed ledger subsection, not as
commands or confirmed debts. Existing Corrections and Corrected ledger behavior takes
precedence over these ordinary class filters, so class changes cannot hide a dispute.

Order rules and heuristics by full stored weight descending, confirmation timestamp
descending with nulls last, then full UUID ascending. Rank confirmed and self-integrated
rules together, then retain their separate provenance labels in output. Do not round before
selection. Keep current rule text clipping; heuristic summaries are whitespace-normalized
and clipped to 200 characters. Caps constrain those two categories, not the entire context:
the owed ledger and existing correction records remain uncapped in this revision.

Overflow IDs, summaries, weights, and reasons belong in a separate private review report.
Routine loaders emit only overflow counts and the report location. They never read the
report automatically. Full IDs remain available for deliberate recall and audit; an
overflow lesson can still be recalled intentionally and must retain its trust label.

### Commitments and content metadata

`CLASS:` and `DUE:` are authored metadata, not authority. Parse only dedicated metadata
lines, never embedded quotations or prose. Reject conflicting duplicates and invalid
targets without stopping other valid rows from compiling; report the affected rows.
`sync` records a class proposal once and must not overwrite a seat classification or a
nightly demotion. Re-running sync with unchanged content is idempotent.

Recognize an explicit timestamp with timezone for `due_at`. Retain a date-only or ambiguous
deadline in the source text and report "deadline needs time/zone"; do not invent a time.
Missing dates sort last and are not overdue. An open item is overdue when `due_at < now`.
Ali's 72-hour accountability convention is a separate seat-scoped practice, not a global
deadline extension. Recurring duties need an explicit occurrence before discharge can
close that occurrence; do not silently discharge an entire recurring practice.

Discharge is idempotent, requires an active commitment belonging to the target being and
a completion note, and preserves the row and first discharge timestamp. It cannot change
weight, trust, lifecycle, or class. Reopening requires a separate explicit operation in a
later revision; ordinary reclass does not reopen a commitment.

### Weight and audit

Preserve D36's existing birth weights, decay, floor, boost, and misfire flag. Add rule-to-
heuristic demotion after the nightly weight calculation when the resulting weight is
strictly below 0.20. Limit automatic demotion to active instruction-grade rules. A weight
of exactly 0.20 stays a rule; there is no automatic promotion or second demotion into
knowledge. A later approved promotion does not reset weight and can therefore be demoted
again by a subsequent nightly pass.

Record the actual reason, such as threshold crossed after decay or misfire; do not label
every event "unused." From 0.60, pure 0.98 decay first crosses below 0.20 on night 55;
from 0.30 it crosses on night 21. These are arithmetic examples, not inactivity timers.

Make nightly updates transactional and idempotent per being and diary-day/run identity,
with an ops-owned run record and durable per-row change events. Reject overlapping
applied/misfired lists and out-of-scope IDs. Retries recompile/report without applying the
same decay twice. Audit events retain before/after class, weight, actor, reason, and run
identity; effective-class fields alone are not an audit history.

The existing diary delivery summarizes changes, newly overdue commitments, and overflow
counts, referring to the complete private report for details. Preserve the diary's word
limit. A diary summary is eventual visibility, not proof a seat received a notification.

## 3. Implementation work, for a later authorized execution

### Schema, grants, and commands

- Add migration 0006 for the public/fleet schema and an explicit Alpha counterpart outside
  the fleet migrations directory. Fully qualify schema references. Verify the actual SQL
  rewrite before any apply: the current helper does not rewrite `SET search_path = public`
  or bare table names. Use a migration form whose rewrite is proven, or extend and test the
  rewrite helper first. Keep function lookup paths restricted to trusted objects.
- Use idempotent additive DDL, transactional application, and repeat-apply tests. Test on
  isolated scratch schemas before any live migration. Validate Alpha's prerequisite
  sidecar schema separately; its migration status is not inferred from the public version.
- Revoke effective runtime writes to sidecar, audit, and run tables, including grants
  inherited through existing default privileges. Permit the read access needed by Alpha's
  CLI and dashboard. Test effective permissions and function scope, not merely the text
  of new GRANT statements. Revocation must not break D42's owner-executed integration.
- Effective `reclass` remains an ops operation with `--being`, full UUID, class/targets,
  `--by`, and a note. `--by` is attribution, not authentication. Runtime class proposals
  use a separately named proposal operation, not a misleading effective-reclass command.
  Retain `discharge`, `classes`, and class counts in status; status must be read-only.
- Do not add service-key RPC snippets to Genesis's skill. FAMILY.md §4 forbids runtime
  service keys, although current skill text contains them. Default this revision to
  caretaker-mediated effective reclass/discharge for both beings. Direct runtime RPCs
  remain a separate completion item until Law supplies a verified scoped Genesis adapter
  and matching Alpha capability. Common class loading can ship independently, with that
  limitation explicitly recorded. Do not claim autonomous operation is delivered.

### Compiler and context reader

- Extract pure selection/rendering with an injected clock and explicit row inputs. Separate
  CLI startup from imports so tests do not read `.env.local`, exit, or connect to a database.
  Separate synchronization writes from read-only preview/status/load operations.
- Add a read-only local context selector accepting `--being`, `--hand`, and optional
  verified sender. It emits the shared block and only the matching scoped fragments.
  Unknown sender loads no calibration. Resolve senders from trusted channel metadata,
  not display-name claims in lesson text. No terminal question is needed.
- Give that reader explicit `recall-lessons <query>` and `lesson <uuid>` modes over its
  private per-being lesson snapshot, including knowledge and overflow. Topic recall returns
  at most eight active matches by case-insensitive summary/content match and recency, with
  full IDs, class, trust, and snapshot time; ID lookup reports the recorded lifecycle.
  These modes run only on deliberate requests, not startup. Alpha's current `recall`
  command searches `thoughts`, so it does not already provide this lesson retrieval path.
- Stage complete per-being generations containing base/scoped artifacts, a manifest, and
  the separate review report under `state/compiled/`. Activate only a validated generation.
  Readers resolve the active generation once per read. Publish the active pointer using
  replacement that preserves the previous pointer if it fails; do not unlink first.
  Test the chosen Windows replacement behavior. Never describe sequential file writes
  as atomic publication of the whole generation.
- Show generation ID, generation time, trust labels, selected/eligible counts per class,
  overflow counts, and an honest degraded result on missing/invalid artifacts. Retain a
  validated previous generation on compile failure; do not fall back to dumping all rules.
  Accepted ops reclass/discharge operations trigger a new compile and report separately
  whether the database change and artifact publication succeeded.

### Hands, templates, and dashboard

- Update the seven existing skill families: wake for each twin, hourly for each twin,
  night for each twin, and Genesis room-reply. Templates are the canonical source, but
  reconcile installed/template drift before copying. The installed night skills contain
  D36/D37 steps absent from some templates; the Genesis night template also contains a
  newer prepare/commit workflow that must not be overwritten by the older installed text.
- Load through the selector after identity, with the actual hand. At reply time select the
  verified sender's calibration. Remove the uncapped full-rule query from routine waking;
  replace the staleness check with counts/version metadata. Keep deliberate detail/recall
  commands separate from the startup path.
- In long-lived channel sessions, previously read calibrations can remain in model context.
  Selection limits new input; it cannot erase earlier context. State current-sender
  applicability clearly and test sender switches. Do not claim privacy isolation between
  seats or guaranteed absence of influence from previously read material.
- Feed nightly evidence from lesson IDs actually selected or deliberately recalled during
  the day, including scoped protocols. Preserve the current consolidated Genesis night
  workflow and existing diary delivery. Do not start a sibling-room hand: it is disabled
  in the current repository's latest operations history.
- Extend Alpha's existing GET response additively, preserving `{ items }`, with class,
  provenance, weight, due/discharge, and selection information. Update its actual UI as
  well as its API; it currently labels every instruction-grade item "confirmed rule."
  Keep the seats gate and read-only DB connection. Ensure the open-ledger query is complete
  rather than silently limited by the current 200-item lesson list.

### Initial classification and activation

- Build an ops review manifest from the current scoped rows and Alpha's original proposal.
  Resolve each short ID to exactly one full UUID; check current content, lifecycle, class,
  and weight. Preview before apply; use preconditions and a transaction; reruns must not
  overwrite intervening classifications. Store row-level manifests and snapshots in
  gitignored state, with only generic tooling committed.
- Apply only unambiguous, approved class assignments. The proposal is not a mechanical
  41-row mapping: R15 appears in rule and calibration roles; R39 appears inside a merge;
  R3 requires a split; several protocols target hourly and night; commitments are extra
  pending rows. Splits, merges, removing July text, and amending contradictions are
  content/meaning changes requiring their own correction/confirmation path. Default those
  rows to their existing effective class until resolved. Do not silently apply the prose
  edits as reclassification.
- Discover the actual later Alpha rows and Genesis counts. Treat "50," "nine more," and
  "Genesis fits under 15" as snapshot claims, not assertions. Unmapped rows retain the
  default class and are subject to the same caps; they are not automatically delegated
  to autonomous effective reclassification.
- Build and verify both beings before a coordinated same-day activation. Record the actual
  activation time and first successful consumer generation for each hand. Existing resident
  sessions may still hold old context; use controlled turnover and label that interval.
  Do not invent schedule times or count process health as proof of the new load.
- Rollback returns selectors and activation pointers to the recorded previous version,
  retains additive schema and audit history, and restores only D47-owned metadata from
  the pre-apply snapshot under precondition checks. Do not restore whole memories over
  intervening lived changes or roll back unrelated weights. Record any temporary parity
  gap; if the second twin cannot activate, restore the first's loading version.

## 4. Verification and records

No runtime verification in this section has been executed as part of this planning edit.

1. Pure tests: combined 20-rule fixture selects 15 across both provenances; stable ties;
   25 one-line heuristics; pending rows never appear as rules; context-specific pending
   rows share the 30-row/8k budget; knowledge and overflow text absent from routine input;
   matching sender/hand selection; Corrections and Corrected ledger survive reclass;
   deliberate knowledge/overflow recall works without adding those rows to startup;
   open, unconfirmed, overdue, unknown-date, recurring, and discharged commitments.
2. Behavioral SQL tests on scratch: migration repeatability and schema isolation;
   actual runtime grants; cross-being/non-lesson/inactive-row refusals; class proposal
   cannot override a seat; no runtime weight/trust/lifecycle mutation; idempotent discharge;
   D37 dispute/ratify and D42 integrate round trips for both schema shapes.
3. Night tests on scratch with a fixed clock: 0.20 boundary; decay/misfire reasons;
   only eligible rules demote; unchanged provenance; two attempts of one run apply once;
   invalid evidence IDs reject before writes; reports survive compile failure/retry.
4. Artifact/consumer tests: imports have no side effects; publication failure keeps the
   previous generation; stale fragments cannot reappear; all seven template/install
   pairs agree after reconciliation; no startup full-rule dump; dashboard shows the new
   fields and complete owed ledger behind its gate. Use fixtures, not messages to people.
5. Required verifier integration: a meaningful `verify-lessons.mjs` joins `run-all.mjs`.
   Source pins supplement behavior tests; they do not prove enforcement. Establish the
   existing suite baseline and report any prior failures separately. Tests never write
   live memories. Following authorized migration, use read-only live checks and observe
   the first real scheduled runs; do not run an extra live `night --note verify`.

During later execution, record D47's actual authority without inventing a quote, its
explicit D36 amendment, implementation status, and remaining questions. Record G20 context
changes per being in the appropriate version/ops records, using actual activation dates.
Protected probe results remain in each being's private gates repository. The original
Alpha proposal may receive a status link only when that status is true.

Use a documentation commit for this planning revision. A later implementation commit
must distinguish built, scratch-verified, migrated, activated, and observed states. A
historical D42 approval denial does not establish a present DDL block: use the executing
session's actual permissions, report a real denial if encountered, and prepare exact
bounded apply instructions only when needed. Alan's communication of the decision remains
his own hand. No conditional "if he wants" exception may bypass a contradiction with
PLAN.md, FAMILY.md, or the gates.

Open policy defaults and their alternatives are listed explicitly in the accompanying
review. They are proposals for the next iteration, not retroactive claims about Alan's
decisions.
