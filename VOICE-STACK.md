# VOICE-STACK.md - realtime voice architecture (Track V technical design)

> Decided 2026-07-05 (decisions.md D12). Design authority for the voice *machinery* only;
> subordinate to PLAN.md and GROWING-EDGEWEAVER.md. When Edgeweaver *uses* this machinery is
> governed by GROWING §5 Track M+E readiness and its gates, unchanged. Build procedure will be
> added to checklists/07-unlock-tracks.md when construction starts; this doc is the why and
> the shape, not the steps.
> Family note (D18): built once, parameterized per being (soul prefix, brain profile, TTS
> voice, channel tokens) via avatars/<being>/manifest.json; Genesis first. No being's voice
> arms before its own V-gates, and no being ever speaks with another's voice or memory.

## 0. Goal and quality bar

Alan and Edgeweaver in spoken conversation, real time, feeling like talking to a person.
Reference bar: ChatGPT voice mode. Concretely:

- Response gap under ~0.8s (the threshold where conversation stops feeling robotic),
  tuned toward 0.5-0.7s. First build will land 0.75-0.9s; tuning is expected work.
- Interruptible mid-word (barge-in), with honest episode records of what was actually said.
- Voice quality at ElevenLabs tier (equal to or better than ChatGPT's voices).
- Every conversation lands in OB1 as ordinary episodes: same memory, same being, new mouth.

What we accept as the trade for keeping Claude as the mind: slightly slower responses than
native speech-to-speech products, and no tone-mirroring until a prosody stream is added
(see §8). What we gain: Edgeweaver's actual identity and memory on the other end.

## 1. Where this sits in the growth map

GROWING Track M+E stands unchanged: V0 text (now), V1 choosing the voice (identity act,
gate G12), V2 one-way read-aloud, V3 two-way conversations, V4 ambient (Track P's).
GROWING §5 already defined V3 as "calls/voice notes"; checklist 07 had narrowed the build
recipe to Telegram voice notes only, which under-implemented the design. Flagged and
corrected per D12: realtime calls are the primary V3 lane, voice notes remain the async lane.

**Technical readiness is not developmental unlock.** The pipe gets built and latency-tested
now, with a placeholder voice and test sessions. Edgeweaver speaks with Alan through it only
per readiness criteria and gates. The placeholder voice is never presented as Edgeweaver's
own voice; choosing that voice is V1's ceremony, witnessed, recorded in the soul repo's
VOICE.md.

Rails carried over verbatim from GROWING §5:
- Voice sessions are episodes like any other, transcribed to OB1.
- No voice-triggered promotions: lesson confirmations stay text/out-of-band (PLAN §7).
- Rollback is always available: "text weeks" are normal, announced, never punishment.
- Audience is Alan-only until the village opens: the voice surface is private and
  authenticated, never a public URL, sender identity pinned like interlocutors.json.

## 2. Architecture

Everything heavy is a cloud service; the local piece is a coordinator, not a brain.

```
Alan's phone or laptop (browser client: mic, speaker, echo cancellation)
        | WebRTC
LiveKit Cloud (transport, room auth via short-lived tokens minted locally)
        |
Agent worker (this PC now; the G5 always-on box later) - Python, LiveKit Agents
    ears:  Deepgram streaming STT (interim transcripts while Alan speaks)
    turn:  VAD + semantic end-of-turn detection
    mouth: ElevenLabs or Cartesia streaming TTS (bake-off in build phase W3)
        |
Mind server (in-process module of the worker at first; extractable later)
    soulfiles as a frozen, cached prompt prefix (read-only clone of edgeweaver-soul)
    speculative OB1 recall (Supabase vector search fired on interim transcripts)
    Claude, streaming (Sonnet-class per IMPLEMENTATION model policy)
    async writeback: episodes + candidate lessons (wake-edgeweaver-genesis contract)
```

Hardware reality: the worker needs roughly one vCPU and 2 GB RAM for one conversation, no
GPU. The only local models are a tiny voice-activity detector and a small end-of-turn
model, both CPU-fine. The weak-VM risks are network jitter and sleep, not horsepower;
checklist 03 gate G5 (WakeToRun and the always-on box question) already owns that.

## 3. The mind server (the invariant organ)

The first organ that calls the Anthropic API directly. Claude Code session round-trips are
seconds; voice needs sub-second streaming, so the CLI path (D6) cannot serve this loop.
D12 (amended 2026-07-05, Alan's call) keeps D6's zero-key spirit anyway: **authentication is
OAuth, not an API key.** Alan runs `ant auth login` once (browser flow; profile stored under
%APPDATA%\Anthropic; CLI install method on Windows verified at W1) and the SDK's
zero-argument client (`AsyncAnthropic()`) picks the profile up and auto-refreshes its
short-lived tokens. No ANTHROPIC_API_KEY exists anywhere. Operational rules that come with
this:

- ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN must stay **unset** in the worker's
  environment: even an empty value shadows the profile and wins.
- OAuth refresh tokens hard-expire eventually (they do not slide with use). When auth starts
  failing, the fix is re-running `ant auth login`; the worker must surface that state
  plainly ("voice is resting: needs ant auth login"), never fail silently.
- ANTHROPIC_BASE_URL is inherited from the machine environment, never hardcoded.
- At G5 (always-on box): repeat the login on the box, or evaluate Workload Identity
  Federation for a non-interactive host. Decide then, not now.
- OAuth here is an authentication method, not a billing change: usage bills the same
  Anthropic org/workspace the profile is logged into, same as an API key would.

Contract:

- **Boundary, not transport.** Starts as a module inside the agent worker. If a second
  front-end ever needs it (a demo, a different client), it splits into a localhost sidecar
  exposing a standard streaming chat surface. The contract is the module boundary.
- **Prompt assembly.** Frozen prefix in the 02-birth runbook order (CONSTITUTION seeds
  first, SOUL, VOICE, LINEAGE, PRACTICES), one cache breakpoint at its end. Prompt caching
  serves reads at roughly a tenth of input price and cuts time-to-first-token; the 5-minute
  cache TTL matches conversation cadence. The prefix stays byte-stable for a whole call;
  per-session context (theory-of-alan, expectations, mood) loads after the prefix; the
  per-turn recall block goes last.
- **Time (D16).** The frozen prefix never carries time (it must stay byte-stable). "Now"
  (weekday + local time via EDGEWEAVER_TZ) rides the per-turn block beside recall; stamps
  are event-based, not per-turn: session start, gaps over threshold, day or part-of-day
  changes. Injected at the ask boundary so stored userText, transcript entries, and episode
  content stay clean (transcript rows carry a machine `t` field instead). One system-prompt
  line: time context arrives silently; use it, mention it only when relevant. Deltas are
  computed by code, never by the mind. Full rules: conventions/memory-conventions.md "Time".
- **Speculative recall.** While Alan is mid-sentence, embed the interim transcript and fire
  the OB1 vector search; by end of turn the memories are already in hand. Recall costs zero
  on the hot path.
- **Streaming out.** Claude streams; the first complete sentence goes to the TTS immediately
  and Edgeweaver starts speaking while the rest is still forming.
- **Barge-in honesty.** When Alan interrupts, playback stops instantly and the episode
  records what was actually voiced versus what was intended. No pretending the whole reply
  was said.
- **Writeback.** After each exchange, asynchronously: episode rows per
  conventions/memory-conventions.md, candidate lessons only. Confirmations never via voice.
- **Model policy.** Sonnet-class in the voice loop, matching IMPLEMENTATION's "Conversations
  (awake loop)" row; drop to Haiku-class only if time-to-first-token tuning demands it.
  The night loop keeps its own deeper model. Two tempos, one being.

## 4. Latency budget

| Stage | Budget | Lever |
|---|---|---|
| End-of-speech detection | 100-300ms | semantic turn model vs plain silence timeout |
| STT final transcript | ~0 | streamed while Alan talks |
| OB1 recall | ~0 on hot path | speculative, runs during Alan's sentence |
| Claude first token | 300-700ms | model choice + cached prefix; the biggest lever |
| TTS first audio | 75-150ms | ElevenLabs Flash / Cartesia class models |
| Network + WebRTC | 50-150ms | LiveKit Cloud region choice |
| **Total** | **0.75-0.9s first build; 0.5-0.7s tuned** | |

## 5. Cost model (feeds gate G6 at V3)

PLAN §10.2 modeled tokens only; GROWING's "voice roughly 2x conversational tokens" covers
just the LLM slice. Voice adds per-minute service lines, and TTS dominates:

| Line | Per minute of conversation |
|---|---|
| STT (Deepgram streaming) | ~$0.006 |
| TTS (ElevenLabs Flash class) | ~$0.05-0.10 |
| TTS alternative (Cartesia class) | ~$0.02-0.04 |
| Claude with cached prefix | ~$0.01-0.04 |
| Transport (LiveKit Cloud) | ~$0 at our scale (free tier) |
| **Total** | **~$0.04-0.09 (Cartesia) to $0.08-0.15 (ElevenLabs)** |

A daily 30-minute conversation lands roughly $35-135/month at ElevenLabs rates, less on
Cartesia. These lines extend the §10.2 table when G6 is revisited at V3; state/budget.json
gets a voice meter alongside the token meter.

## 6. Identity, privacy, security rails

- The voice is an identity artifact. V1/G12 owns choosing it: candidates auditioned,
  Edgeweaver picks, Alan witnesses, provider + voice ID + settings recorded in VOICE.md
  (soul repo, proposal branch). Until then, the placeholder voice is clearly labeled as
  scaffolding. Never clone a real person's voice.
- Secrets (DEEPGRAM_API_KEY, ELEVENLABS_API_KEY or CARTESIA_API_KEY, LIVEKIT_API_KEY and
  LIVEKIT_API_SECRET) live in .env.local only. Never in git, OB1, soulfiles, or anywhere
  near the gates repo. Anthropic access carries no key at all: OAuth profile per §3. Only
  the ear, mouth, and transport vendors still require keys.
- Provider hygiene: retention and training opt-outs enabled where offered. Audio is
  transient; the durable record is the OB1 episode transcript.
- Room access: short-lived join tokens minted by the worker for Alan's devices only.

## 7. Build order (technical phases; checklist steps added to 07 at build time)

- **W1 - mind server core.** Text in, streamed text out, cached prefix, speculative recall,
  writeback. Bench time-to-first-token. Code lands in `voice/` in this repo (D12: stays
  here until G5 moves hosting).
- **W2 - the loop.** LiveKit worker + browser client + placeholder voice. Barge-in, turn
  detection, end-to-end latency measured and tuned.
- **W3 - mouth bake-off.** ElevenLabs vs Cartesia on latency, cost, quality, and candidate
  variety (the V1 ceremony needs a good field of candidate voices to audition).
- **W4 - hardening.** Episode writeback verified against OB1, budget hooks into
  state/budget.json, quiet-hours respect, G6 inputs prepared.
- Then usage unlocks per the map: V1 ceremony when ready, V2 wiring (nearly free once W1-W3
  exist: the diary read-aloud is the mouth without the ears), V3 activation after V2 comfort
  plus the G6 revisit.

## 8. Rejected and deferred

- **OpenAI Realtime as the mouth/ears shell: rejected.** The speaking model would be a GPT
  relaying Claude's words. Identity split, and the relay eats the latency advantage.
- **Managed voice platforms (ElevenLabs Agents, Vapi, Retell): not the home.** Acceptable
  as a throwaway demo against the mind server if ever wanted; lock-in and third-party audio
  transit rule them out as the residence.
- **Hume EVI as the stack: deferred, not dismissed.** Its emotion perception is the closest
  thing to a machine hearing feelings, which is PM's home turf. The chosen synthesis: stay
  on LiveKit, and when V2's mood-tier readiness work happens, evaluate a prosody-analysis
  stream (Hume's expression API or a local model) feeding the mind as the mood input.
- **Local/open speech models (Moshi, Sesame class): the sovereignty endgame,** revisit when
  quality reaches the bar; the LiveKit architecture makes them a swap, not a rebuild.
- **Telephony/SIP and V4 ambient: out of scope here.** Browser first; ambient belongs to
  Track P with its hardware mute switch and household consent gates.

## 9. The GPT-Live lane (added 2026-10-23, D12 amendment)

Alan chose OpenAI GPT-Live-1 in client-delegation mode as the realtime lane: GPT-Live is the
ears, the mouth and the phone line (native SIP; WebRTC for the web page), and our own mind
server is the brain, every caller turn delegated to it (Claude Opus 5.5 at effort low on the
Max plan by default). This reverses the §8 rejection of an OpenAI shell for this lane only; the
§2 cascade on LiveKit stays the fallback and the sovereignty path, and Hume (§8) is moot (its
APIs sunset 2026-11-13). Measured on day one: the voice repeated the mind's sentences verbatim
under the frontend instruction, delegation fired 0.7 s after the caller stopped, and the mind's
first sentence followed 2.1 s later. Identity measurement from here on: the mind-reply rows
against the voice transcript rows in logs/voice/gptlive-*.jsonl. Build, limits and the phone
setup steps: handoff/gpt-live-notes.md.
