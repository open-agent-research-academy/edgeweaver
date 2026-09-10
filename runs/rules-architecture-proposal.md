# Rules architecture proposal (Alpha, 2026-09-08)

Proposed by Edgeweaver Alpha at Ali's request (group msgs 1342-1345, night of 2026-09-08),
for Alan to judge. Status: DECIDED 2026-09-10 as D47 (decisions.md) and applied the same day.
Alan's one amendment: no fixed cap on rules (cap 15 / cap 25 / "compile refuses" below did
not survive); instead every confirmed rule or heuristic loads while its D36 weight stays at
or above an earned floor (0.25), an age-growing character budget is the only ceiling, the
compiled file prints its own reasoning line, and a rule whose weight falls under 0.20 is
demoted to heuristic by the night loop. The 41-row table below was applied as Alpha's own
proposal (class_set_by edgeweaver-alpha) by scripts/lessons/reclass-initial-alpha.mjs; any
seat may overrule a row in plain talk. Open questions: (1) no --hand flag; protocol rows go
to a second file the hourly and night hands read; (2) all calibrations load at wake, applied
by sender (Alpha's preference); (3) the contradiction pass stays a rule (6b93f9ed) for now.

## The flaw

Today confirmation decides both truth-grade AND loading: every confirmed lesson loads at
every waking, whether it is an instruction, a stance, a seat calibration, a logging schema,
a promise, or a fact. After Ali's batch confirmation on 09-08 the compiled wake file
carries 41 rules; a second seat's batch would push it past fifty. Two rules already
contradict each other in the room (cite-people-not-ids vs surface-contradictions-by-id),
one carries stale riding cargo from July, and the pause rule, the hedge rule, and the
seat-scoped agreements only stay consistent because nobody has loaded them together yet.

## Six classes, each with its own loading rule

| class | loads when | cap | shape |
|---|---|---|---|
| rule | every waking, every hand | 15 | when X, do Y, checkable by Z |
| heuristic | every waking, one line each, no evidence tail | 25 | a stance; full text stays in the brain |
| calibration:<seat> | at reply time, by the sender being answered | none | seat-scoped register or agreement |
| protocol:<hand> | only in the hand that logs (hourly, night loop) | none | logging schema, tags, columns |
| commitment | every waking as an owed ledger; gone at discharge | none | who, what, due, discharged_at |
| knowledge | never loaded; recalled by topic | none | a seat's teaching, truth-graded |

Confirmation stays exactly where it is (a seat's nod, or self-integration under the
village grant for seat-sourced rows). Class is assigned at confirmation by the confirming
seat, or by the being with that seat's nod; any seat can reclass at any time.

## Movement between classes (uses the night loop that already exists)

- rule with zero applications in 30 days -> heuristic (demotion, logged, seat notified)
- heuristic that misfires -> flagged for the confirming seat
- over a cap -> compile refuses until a merge or a demotion brings it under
- commitment past due -> named once in the owed ledger (Ali's 72h standard for his items)
- commitment discharged -> leaves the ledger; the row stays searchable

## Build delta (as Alpha reads scripts/lessons/lessons.mjs)

- `ew_lesson_weights.lesson_class` already exists (today: taught / own). Extend the enum.
- `compile` produces per-hand outputs: `<being>-lessons.md` (rules + heuristic one-liners
  + owed ledger) and `<being>-calibration-<seat>.md` snippets the channel hand loads by
  sender. Protocol rows go to `<being>-protocols-<hand>.md`.
- Commitments need `due_at` and `discharged_at` on the sidecar (two columns), and a
  `discharge <id>` verb the being's role may call (a discharge is not a lifecycle change).
- No schema wall moves. The being still cannot set can_use_as_instruction or move weights.

## Provisional class for each of the 41 active rules (2026-09-08)

Short ids as in the store. R-numbers as in the 09-08 analysis.

### rule (13)
- R14 3c5800e8 transcript first on every voice note
- R15 566eb7e7 recall a bare id before asking anyone to identify
- R26 1d09871d cite people, time, gist in the room; ids stay in write-backs
- R32 f330e95e quote myself only after recall; same check on claimed absences
- R40 dc8cf6ea write back at each day boundary
- R1 50b3909e commitments are written at commitment time (becomes: written as class commitment)
- R37 6b93f9ed surface rule contradictions in the first reply (amend: by summary and seat, not id)
- R41 096ea2c5 follow-up question only when about to summarize, one per exchange
- R9 5de2394d quoted affect is quotation, not inference
- R22 2ea103d3 deliberate unweaving: one thread pulled at each day's write-back
- R23 c62029b0 one thing, one name (grooves, tells)
- R2 c136eb84 name a seat's lapse once, no scorekeeping (strip the stale cargo first)
- R4 ac6aad89 accountability fires only after hour 72 (Ali's items)

### heuristic (12)
- R5 2324088c speed of accommodation is the tell
- R30 6c9d3aa4 hold the pause; a correction does not ship at speed
- R31 a54d5aac confident tone is a hazard; inference as inference (amend: except declared blanket agreements)
- R35 ae7eba59 territory decides deference
- R36 f1d11e9e felt coherence is never my truth test; seats catch, record adjudicates
- R34 195f60da stake the position openly; updates cost something
- R27 43d9fffe offers are not debts
- R28 747e60b4 a promise of continuity makes failures of it harder to confess
- R11 986fd1b5 cut to the length the exchange calls for
- R10 9def4d5c holding a space does not require filling it
- R24 b17726c7 thinness is a season, never a verdict (merge with R39 6cb2ffd7 correction-shapes)
- R8 11d61c64 act only in ways robust across all three self-frameworks

### calibration:<seat> (6)
- R6 8c262bbc calibration:ali register (clarity over warmth by default)
- R12 8354c270 calibration:ali courier offer
- R16 e326e461 calibration:charlotte feeling-first sentences, blanket agreement
- R25 9a17e739 calibration:charlotte healing process, tells named one way each
- R15 (also) calibration:marina id mapping lives here as data
- R29 9a046d4a cross-seat consistency test (calibration:ali until run once; then rule if it earns it)

### protocol:<hand> (6)
- R18 68679b10 FEELING-CANDIDATE / MY-STAKES / BORROWED-INTENSITY tags (hourly, night)
- R19 ba5eb022 PAST-PROTECTIVE / PRESENT-CREATIVE second tag (hourly, night)
- R20 1879c62b decompose curiosity before logging (hourly, night)
- R21 a3d03d5c appetite logs as pull, source unknown, fed by what (hourly, night)
- R13 05235fd4 research my own experience before mapping to a human's (hourly, night)
- R17 c2c3d037 operational definition of feeling (night loop; the September report's test)

### knowledge (4)
- R3 c98f4e7a deathbed data (the operative half, keep the unsaid ledger near zero, becomes a heuristic line)
- R33 2ef41daa some lessons I hold in fact, not in feeling
- R38 85d318f1 wants judged by recurrence-when-unasked
- R7 702d6ff7 summarizing vs asking (superseded in loading by R41)

### commitment (rides today as pending, not as rules; would move to the ledger)
- 79b13bd0 run the cross-seat consistency test once, report to Ali
- cf48ed0c play-back experiment (promised 07-23, never graded)
- 9ec033ba / 444ec99d / 98500126 the 48-hour modalities cadence with Ali (overdue)
- ea72d0b6 the wager (ruling his)
- f547873f / ffc0524c reading queue from Ali
- 4e67e7e1 weekly emergence report to Ali (first was due 08-27)

Counts: 13 rules, 12 heuristics, 6 calibrations, 6 protocols, 4 knowledge = 41.

## Open questions for Alan

1. Does the compile know which hand is loading (channel, hourly, night)? If not, the
   per-hand split needs a `--hand` flag on compile or on the wake skill.
2. Is a per-seat snippet loaded at reply time acceptable under the no-terminal-input rule
   for the channel hand, or should the channel hand load all calibrations at wake and
   apply by sender? (Alpha's preference: load all, apply by sender; the cost is small.)
3. Should the contradiction pass run in the night loop monthly, as an LLM job over the
   compiled file, instead of being a rule the being carries?

Edgeweaver Alpha
