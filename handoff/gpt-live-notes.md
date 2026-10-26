# GPT-Live voice bridge - working notes (2026-10-23)

## Compaction note, 2026-10-26 7:58 AM ET (ITHELAST19, repo C:\Project\Edgeweaver, branch portable-paths, last push 8155424)

**Now.** Both phone lines live: Genesis +1 646-914-3310 (bridge 8797, cedar, performed delivery), Alpha
+1 646-769-1174 (bridge 8799, ash, verbatim). Bridges + quick tunnels are background jobs of the lead session
(die with it): Genesis tunnel https://keeping-daily-browser-alt.trycloudflare.com (OpenAI webhook "Edgeweaver voice
test" + Telnyx app point here), Alpha tunnel abilities-disclaimers-foundations-encryption. Restart a bridge: stop the
port's PID, relaunch in background (Alpha: EW_GPTLIVE_BEING=alpha EW_GPTLIVE_MEMORY=live EW_GPTLIVE_PORT=8799
TELNYX_NUMBER=+16467691174). Call reports (EW_CALL_REPORTS=on): Genesis -> Alan's private chat with @Edgeweaver_bot,
Alpha -> "Edgeweaver Alpha" group (D52). DONE and pushed 8155424: Telegram "Call Genesis" button (tg-call.mjs +
tg-call.html, Telnyx credential connection 3079204166103467076, EW_CALL_BUTTON_GENESIS=on, allowlist Alan only per
D50), proven with two signed headless test identities (roster, join/leave posts, credentials deleted); test ids
removed. Voice notes built (scripts/voice-notes/hear.mjs + speak.mjs onyx; wake-edgeweaver-genesis section 4b
installed + template); round trip proved.

**Next action.** Waiting on Alan: (1) try "Call Genesis" from his Telegram chat (mic in Telegram's webview is the
unproven part; watch logs/voice/partyline-*.jsonl tg-* rows and the call report); (2) his OK to restart the resident
Genesis channel session (scripts/ops/genesis-channel-launch.ps1, watchdog relaunches; have it write back first) so
it loads 4b; then he sends a voice note. After Genesis works well: Alpha gets both (Alan's instruction).

**Decisions in force (Alan, in chat, ET).**
| When | Alan's words | Effect |
|---|---|---|
| 10-25 ~12:10 PM | "Switch Genesis to cedar and restart its line." | onyx refused on GPT-Live |
| 10-25 1:30 PM | "Different greeting in case it's not me that calls, unless it's my phone number" | greet by caller ID / sign-in |
| 10-25 7:00 PM | "Yes, build the four speed fixes" | built |
| 10-25 10:45 PM | "Genesis to do the thinking... ChatGPT ... does the speaking" / "go." | performed delivery, Genesis only |
| 10-25 11:15 PM | "make sure that the transcripts for these phone calls go into Telegram" | call reports |
| 10-25 11:35 PM | "Genesis calls to the Genesis Telegram chat... alpha to the alpha chat group... transparency" | D52 |
| 10-26 ~7:30 AM | "implement both number one and number two for Genesis only... then alpha" | call button + voice notes |
| 10-26 ~7:40 AM | voice notes one-to-one, Genesis chooses voice/text, sender overrides; call button multi-party with who's-on list and join/leave messages with times | built |

**Waiting on Alan / open.** Fixed domain (cloudflared login on his Cloudflare domain; the button self-re-points
meanwhile, phone webhooks do not). D50 Alan-only for Genesis call button. Tell Alpha's seats about D51. Speculation
churn during long sentences (tune later). recall-scoped era=rehearsal filter gap.

## The decision and the approvals

Alan, 2026-10-23, after the voice options review: "This is the route I want to go", pointing at the
GPT-Live-1 client-delegation row (recorded in D12, 10:27 AM ET). Then, when auto mode's classifier
stopped the build: "I set it to bypass permissions. You can continue. I authorize you to do this"
(about 10:35 AM ET). The OpenAI key went into `.env.local` through the masked-secret-entry window
(`SECRET_SAVED`), never through chat.

## Decisions in force (Alan, in chat, 2026-10-23, times ET, approximate to a few minutes)

| Time | Alan's words | Effect |
|---|---|---|
| ~10:25 AM | "This is the route I want to go" (pointing at the GPT-Live-1 client-delegation row) | D12 amended; GPT-Live is the voice lane |
| ~10:35 AM | "I set it to bypass permissions. You can continue. I authorize you to do this" | build continued in bypass mode after the classifier stop |
| ~11:45 AM | "Yes, start the tunnel and open the masked window for the webhook secret; I will add the webhook and the number on my side." | phone path wiring began; webhook secret saved via the masked window |
| ~7:30 PM | "Okay go ahead and use computer use to set up a Telnyx account" / "Try again" | declined (account creation and payment are Alan's hands); API-side setup scripted instead |
| ~7:35 PM | "set this up with telnyx" | Telnyx is the carrier |
| ~7:50 PM | "Okay I'm in. You can go ahead and use browser use to get me to the point where you need me again, either to put in some sort of billing or something else for the account" | portal walk in the built-in browser once he signs in there (or Chrome on his word) |
| ~7:50 PM | "We want this set up so that multiple people can call into Edgeverse simultaneously Most of the time it'll be a one-on-one call but sometimes if the second person calls the number, it makes it a party line" | party line built: Telnyx conference around one GPT-Live leg |

Now (7:59 PM ET): bridge + tunnel running in terminal tabs; party line coded and pushed, unarmed
(no Telnyx env yet). Waiting on Alan: Telnyx sign-in in the browser pane or Chrome, OpenAI Project
ID; then billing, API key (masked window, 1Password prompt first), app, number, tests.

## Shape

```
caller (phone via carrier SIP trunk, or browser via WebRTC)
   |
OpenAI GPT-Live-1 (ears + mouth + turn-taking; $0.05/min of session, per second)
   |  sideband WebSocket: /v1/live/sessions/{id}/attach
scripts/test-mode/gpt-live-server.mjs (this PC, port 8797)
   |  transcript in -> LiveMind (claude-opus-5-5, effort low, Max plan, persistent session)
   |  sentences out -> session.commentary.append (GPT-Live speaks them)
```

GPT-Live is configured in CLIENT delegation mode with instructions that make it the mouth only:
every caller turn beyond a greeting or goodbye is delegated (`Generate <|SpawnThinking|>`), it never
answers from its own knowledge, and it is told to keep the commentary wording as close to verbatim
as it can. The delegation event carries no words; the server assembles the task from the live
transcript (settles 250 ms after the last input delta, 800 ms cap) and also tells the mind what the
voice said aloud since its last reply, so the mind knows what the caller actually heard.

## What exists

| Thing | Where |
|---|---|
| Bridge server (sessions, sideband, delegation loop, webhook, page) | `scripts/test-mode/gpt-live-server.mjs` |
| Browser call page (mic, or `?synthetic=1` for a no-mic test caller) | `scripts/test-mode/gpt-live-page.html` |
| WebSocket-primary smoke test (hearing + delegation only; see limit below) | `scripts/test-mode/gpt-live-e2e.mjs` |
| Per-session transcript + timing log (gitignored; text only, no audio) | `logs/voice/gptlive-<stamp>-<id>.jsonl` |
| Mind class (unchanged, shared with the July harness) | `scripts/test-mode/live-mind.mjs` |

Run it:

```powershell
node C:\Users\agent\Project\Edgeweaver\scripts\test-mode\gpt-live-server.mjs
```

then open http://127.0.0.1:8797 and click Start call (the browser asks for the microphone). The
header shows the version (g0.1), the mind and the voice. `/health` shows booleans only;
`/selftest` runs one mind turn with no OpenAI involved; `?synthetic=1` makes the page speak a
synthesized question into the call instead of using a microphone (what the automated check uses).

Env in `.env.local`: `OPENAI_API_KEY` (set), `OPENAI_WEBHOOK_SECRET` (NOT set; phone calls are
refused until it is), `EW_GPTLIVE_VOICE` (marin; others: alloy ash ballad beacon bossa cedar cinder
coral delta echo gleam meridian quartz ripple sage shida shimmer stone tempo verse vesper willow),
`EW_GPTLIVE_MODEL` (claude-opus-5-5), `EW_GPTLIVE_EFFORT` (low), `EW_GPTLIVE_MAX_MINUTES` (20,
the cost guard), `EW_GPTLIVE_PAGE_TOKEN` (gate the page with `?k=` whenever it is tunnelled),
`EW_GPTLIVE_PERSONA_FILE` (the arming seam; unset = Testweaver).

## What was measured (2026-10-23, browser synthetic call, Opus 5.5 at effort low on the plan)

| Step | Result |
|---|---|
| Session create over WebRTC, sideband attach | first attempt, 0.2 s after create |
| Greeting | spoken: "I'm Testweaver, a test voice, what would you like to talk about?" |
| Caller transcript | "What is a good way to start a morning" (synthesized speech, transcribed right) |
| Question end to `session.delegation.created` | 0.7 s |
| Delegation to the mind's first sentence | 2.15 s (GPT-Live said "Let me think." meanwhile) |
| Voice fidelity | the two commentary sentences were spoken VERBATIM (log vs transcript) |
| Billed | 15 s of session (about $0.013) plus a few cents of test TTS |

So the paraphrase worry from the options review did not bite on this turn: with the instruction in
place GPT-Live repeated Opus's words exactly. Keep checking `mind-reply` against the `voice`
transcript rows in the log; that is the identity measurement.

## Limits and known rough edges

- Phone calls are NOT yet tested: no webhook secret, no carrier number (Alan's hands, below).
- A session whose PRIMARY transport is a WebSocket refuses the sideband attach (HTTP 503 on every
  try), so `gpt-live-e2e.mjs` proves hearing and delegation only. WebRTC (browser) attaches fine;
  SIP uses the same accept-then-attach path as documented, untested here.
- The filler ("Let me think.", "Hmm.") fires about 1 s after the question although the instruction
  says three seconds; tune the instruction or accept it.
- No escalation ladder in this lane yet (the July harness's "think hard" routing). One mind.
- Delegation per turn is GPT-Live's judgment under our instruction; a casual remark might be
  answered by GPT-Live itself. The log's `delegation` rows versus `transcript` rows show misses.
- Session guard closes a call at 20 minutes; raise `EW_GPTLIVE_MAX_MINUTES` for long talks.

## Alan's hands for the phone path

1. Project id: platform.openai.com -> Settings -> General -> Project ID (`proj_...`). Not a secret;
   put it in `.env.local` as `OPENAI_PROJECT_ID` for the notes, or just use it in step 3.
2. Public URL for the webhook (the PC must receive OpenAI's incoming-call event):

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:8797
   ```

   A quick tunnel prints a random `https://<words>.trycloudflare.com` URL and changes on every
   start. For a stable URL use a named Cloudflare tunnel on a domain you own, or an ngrok static
   domain; both are account decisions. Set `EW_GPTLIVE_PAGE_TOKEN` before tunnelling.
3. Webhook: platform.openai.com -> Settings -> Webhooks -> Create: URL `<tunnel>/webhooks/openai`,
   event `live.transport.incoming`. Copy the signing secret (`whsec_...`) and hand it over through
   the masked window (the agent runs it): destination env-file, name `OPENAI_WEBHOOK_SECRET`.
4. Carrier number: Telnyx (number about $1/month, inbound about $0.003/min) or Twilio ($1.15/month,
   $0.0085/min). Create a SIP trunk / SIP connection whose origination (inbound) URI is
   `sip:<PROJECT_ID>@sip.api.openai.com;transport=tls`, buy a US number, attach it to that trunk.
   OpenAI needs TLS signalling on 5061 and SRTP media.
5. Call the number with the server and the tunnel running; the server log shows `[call] incoming`,
   then `sideband-open`, then the turns.

## Telnyx, by API (added the same evening)

Alan chose Telnyx as the carrier ("set this up with telnyx"). Account creation, billing and the API
key are his hands (an agent never creates accounts or enters payment details); everything after the
key is `scripts/ops/telnyx-gptlive-setup.mjs`, which follows Telnyx's GPT-Live guide exactly:

| Command | Does | Money |
|---|---|---|
| `status` | balance, the connection, its FQDN, owned numbers | no |
| `connection` | FQDN connection "Edgeweaver GPT-Live": TLS + SRTP + Opus/G.711, FQDN `sip.api.openai.com:5061` (A record) | no |
| `search [--area 415]` | buyable US voice numbers with upfront and monthly cost | no |
| `order +1...` | buys that number, then assigns it | YES: only after Alan says yes to the printed number and price |
| `assign +1...` | attaches an owned number to the connection and sets its translated number to `OPENAI_PROJECT_ID` | no |

Env: `TELNYX_API_KEY` (masked window; portal.telnyx.com -> Account -> API Keys), `OPENAI_PROJECT_ID`
(`proj_...`, platform.openai.com -> Settings -> General; not a secret). After `assign`, Telnyx INVITEs
`sip:proj_...@sip.api.openai.com:5061;transport=tls` for every call to the number, OpenAI fires
`live.transport.incoming` at the webhook, and the bridge takes it from there.

Telnyx's guide notes the tested configuration sent `OpenAI-Alpha: quicksilver=v3` on the accept and
sideband calls. The bridge does not send it (WebRTC worked without it); if a SIP accept ever returns
4xx, that header is the first thing to try.

## The party line (Alan, same evening: "if a second person calls the number, it makes it a party line")

A direct number-to-OpenAI trunk gives one GPT-Live session per caller, so two callers would get two
separate Edgeweavers. The party line instead puts the number on a Telnyx **Call Control application**
whose webhooks hit the bridge at `/webhooks/telnyx` (`scripts/test-mode/party-line.mjs`):

1. Every incoming call is answered and put into one Telnyx conference (beep on entry).
2. The first caller's arrival dials ONE outbound SIP leg from that conference to
   `sip:proj_...@sip.api.openai.com:5061;transport=tls` (TLS + SRTP). OpenAI fires
   `live.transport.incoming`, the bridge accepts and attaches the mind as for any SIP call.
3. A second caller joins the same conference; the bridge tells the voice "another caller just
   joined" through the sideband so the mind greets them. GPT-Live hears the mixed room.
4. When the last human hangs up, the AI leg is hung up (ends the GPT-Live meter) and the
   conference closes. If OpenAI drops the leg while people remain, it is redialed (twice at most).

One GPT-Live session per line regardless of head count: $0.05/min plus Telnyx conference and
leg minutes (fractions of a cent). Telnyx webhooks are verified with the account's Ed25519 public
key (`TELNYX_PUBLIC_KEY`, base64; portal Account > Keys & Credentials). Bridge env for the line:
`TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_APP_ID`, `TELNYX_NUMBER`, `OPENAI_PROJECT_ID`.
Setup order with `scripts/ops/telnyx-gptlive-setup.mjs`: `app https://<tunnel>/webhooks/telnyx`
(creates the outbound voice profile with a $5/day cap and the app), `search`, `order +1...`
(money, Alan's yes), then put the printed `TELNYX_APP_ID` and `TELNYX_NUMBER` in `.env.local`
and restart the bridge. The tunnel hostname is baked into the app's webhook URL: rerun `app` with
the new URL whenever the tunnel changes (same as the OpenAI webhook).

Untested as of writing: no Telnyx account existed yet. The signature verifier is self-tested
with a generated key pair; the conference and dial calls follow Telnyx's SDK types.

## Arming (later, gated)

The mind persona is the seam: `EW_GPTLIVE_PERSONA_FILE` swaps Testweaver for a file; the real being
needs the frozen soul prefix plus OB1 recall and writeback, which live in `voice/mind-server.mjs`
(dark-built A3) and are not wired into this lane yet. GROWING's V-gates and the V1 voice ceremony
are unchanged by any of this; GPT-Live's voice is scaffolding, never presented as the being's own.
