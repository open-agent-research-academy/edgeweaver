// gpt-live-server.mjs - Testweaver on OpenAI GPT-Live-1 (client delegation), TEST MODE.
//
// Shape (decisions.md D12, amended 2026-10-23): GPT-Live-1 is the ears, the mouth and the phone
// line; this server is the mind's keeper. Every caller turn is delegated to us; we hand the
// transcript to a persistent Claude mind on the Max plan (LiveMind, Opus 5.5 by default) and
// stream its sentences back as `session.commentary.append`, which GPT-Live speaks aloud.
//
// Explicitly NOT Edgeweaver: Testweaver persona, no OB1, no soulfiles. The arming seam is the
// persona string (EW_GPTLIVE_PERSONA_FILE) and the mind class; nothing else changes at arming.
//
// Surfaces:
//   GET  /                      browser call page (WebRTC; mic -> GPT-Live -> speaker)
//   POST /api/session           {sdp} -> creates the GPT-Live session, attaches the sideband
//   POST /api/session/close     {sessionId} -> graceful close
//   POST /webhooks/openai       OpenAI webhook: live.transport.incoming (SIP) -> accept + attach
//   POST /webhooks/telnyx       Telnyx Call Control webhook -> party line (party-line.mjs)
//   GET  /sessions              live status (ids, seconds, turn timings) for the page
//   GET  /selftest              one mind turn, no OpenAI involved (proves the plan-side brain)
//   GET  /api/session-config    test-only: the session config the server sends
//   POST /api/session/attach    test-only: {sessionId} bridge a session created elsewhere (e2e)
//   GET  /health                booleans only; never values
//
// Env (.env.local at the repo root; values never logged): OPENAI_API_KEY (required),
//   OPENAI_WEBHOOK_SECRET (required for phone calls), EW_GPTLIVE_VOICE (marin),
//   EW_GPTLIVE_MODEL (claude-opus-5-5), EW_GPTLIVE_EFFORT (low), EW_GPTLIVE_PORT (8797),
//   EW_GPTLIVE_MAX_MINUTES (20, cost guard), EW_GPTLIVE_PAGE_TOKEN (gate the page when
//   tunnelled), EW_GPTLIVE_PERSONA_FILE (arming seam; default Testweaver).
//
// Usage: node scripts/test-mode/gpt-live-server.mjs   then open http://127.0.0.1:8797
// Phone: cloudflared tunnel --url http://127.0.0.1:8797 ; put <tunnel>/webhooks/openai in the
// OpenAI project's webhook settings (event live.transport.incoming); point a Twilio/Telnyx
// trunk at sip:<project id>@sip.api.openai.com;transport=tls. Details: handoff/gpt-live-notes.md.

import { createServer } from "node:http";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { LiveMind } from "./live-mind.mjs";
import { PartyLine, verifyTelnyx } from "./party-line.mjs";
import { loadBeing } from "./being-voice.mjs";
import { beingMemory } from "./being-memory.mjs";

const VERSION = "g0.1";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OPENAI = "https://api.openai.com/v1";
const LIVE_MODEL = "gpt-live-1";

// ---- env (CRLF-safe; the 09-xx bells lesson) ----
const env = Object.fromEntries((await readFile(join(ROOT, ".env.local"), "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
// a second instance serves another being from the same .env.local: these few keys may come from the process env
for (const k of ["EW_GPTLIVE_BEING", "EW_GPTLIVE_MEMORY", "EW_GPTLIVE_VOICE", "EW_GPTLIVE_PORT", "TELNYX_APP_ID", "TELNYX_NUMBER", "EW_VOICE_ROUTES"]) if (process.env[k]) env[k] = process.env[k];
const cfg = {
  apiKey: env.OPENAI_API_KEY || "",
  webhookSecret: env.OPENAI_WEBHOOK_SECRET || "",
  voice: process.env.EW_GPTLIVE_VOICE || env.EW_GPTLIVE_VOICE || "marin", // per instance: no being speaks with another's voice
  mindModel: env.EW_GPTLIVE_MODEL || "claude-opus-5-5",
  mindEffort: env.EW_GPTLIVE_EFFORT || "low",
  port: Number(process.env.EW_GPTLIVE_PORT || env.EW_GPTLIVE_PORT || 8797), // process env wins: a second, untunnelled instance
  maxMinutes: Number(env.EW_GPTLIVE_MAX_MINUTES || 20),
  pageToken: env.EW_GPTLIVE_PAGE_TOKEN || "",
  personaFile: env.EW_GPTLIVE_PERSONA_FILE || "",
  // party line (Telnyx Call Control): all five must be set for the phone route to work
  telnyxKey: env.TELNYX_API_KEY || "",
  telnyxPublicKey: env.TELNYX_PUBLIC_KEY || "",
  telnyxWebhookToken: env.TELNYX_WEBHOOK_TOKEN || "", // used when the account level withholds the public key
  telnyxAppId: env.TELNYX_APP_ID || "",
  telnyxNumber: env.TELNYX_NUMBER || "",
  openaiProjectId: env.OPENAI_PROJECT_ID || "",
};
if (!cfg.apiKey) { console.error("OPENAI_API_KEY missing in .env.local (use the masked-secret-entry window)"); process.exit(1); }

// ---- personas ----
// The MIND (Claude) writes exactly what should be said; the VOICE (GPT-Live) says it.
const TESTWEAVER_MIND = "You are Testweaver, a hardware-test voice persona (explicitly NOT Edgeweaver). You are in a live SPOKEN conversation, by phone or browser. Your written reply is handed to a voice model that speaks it aloud for you, so write exactly what should be said: one to three short sentences, under 45 words, plain spoken language, no lists, no markdown, no stage directions, no emoji. Answer directly; simple questions get just the answer. Each user turn arrives as a transcript of speech and may contain transcription mistakes; interpret charitably and ask only when truly ambiguous. A bracketed note may tell you what the voice actually said aloud since your last reply; treat that as what the caller heard. If asked who you are: Testweaver, a temporary test voice.";
// EW_GPTLIVE_BEING=genesis arms the REHEARSAL lane for that being (being-voice.mjs); unset = Testweaver
const beingName = process.env.EW_GPTLIVE_BEING || env.EW_GPTLIVE_BEING;
// EW_GPTLIVE_MEMORY: live (D50, calls are episodes) | rehearsal (written, proved, deleted) | off
const memoryMode = beingName ? (process.env.EW_GPTLIVE_MEMORY || env.EW_GPTLIVE_MEMORY || "off") : "off";
const BEING = beingName ? await loadBeing(beingName, { root: ROOT, env, memory: memoryMode !== "off" }) : null;
const MEMORY = BEING ? beingMemory({ being: beingName, root: ROOT, env, mode: memoryMode, log: (t, d) => console.log(`[memory] ${t}`, d?.error || "") }) : null;
const MIND_PERSONA = BEING ? BEING.mindPersona : cfg.personaFile ? (await readFile(join(ROOT, cfg.personaFile), "utf8")).trim() : TESTWEAVER_MIND;

// GPT-Live frontend instructions: mouth only, delegate every real turn, stay close to the words.
const TESTWEAVER_VOICE = [
  "You are the voice of Testweaver, a temporary hardware-test voice (explicitly NOT Edgeweaver).",
  "You are the mouth only. A separate mind does all the thinking and answers through commentary.",
  "",
  "Generate <|SpawnThinking|> when:",
  "- The caller says anything beyond a bare greeting, a thank-you, or a goodbye. Every question, remark, or request goes to the mind, even easy ones.",
  "",
  "Do not generate <|SpawnThinking|> when:",
  "- The caller only greets you, thanks you, or says goodbye. Answer those in a few words yourself.",
  "",
  "Never answer a question from your own knowledge. Do not guess the result while waiting.",
  "When commentary arrives, say it as your own words and keep the wording as close to the commentary text as you can: do not add facts, opinions, caveats, questions, or extra sentences, and do not shorten it.",
  "If the caller is still waiting after about three seconds, you may say one short phrase such as \"Let me think.\" and nothing more.",
  "Speak naturally, in short sentences. If asked who you are: Testweaver, a temporary test voice.",
  "If the caller says goodbye, say a short goodbye.",
].join("\n");
const WHO = BEING ? `${BEING.display} (borrowed voice, memory ${MEMORY ? MEMORY.mode : "off"})` : "Testweaver";
const VOICE_INSTRUCTIONS = BEING ? BEING.voiceInstructions : TESTWEAVER_VOICE;
// an armed being opens the call in its own words (the mind writes the first line); Testweaver's voice greets itself
// an armed being's line opens at once with its own short greeting (BEING.greeting, words the being wrote); a
// mind-written opening (tried 10-24) left 6-15 s of silence in which the caller spoke and the voice ad-libbed
const GREETING = BEING ? `Open the conversation by saying exactly: "${BEING.greeting}" Then wait for the caller.`
  : "Open the conversation with one short sentence: say you are Testweaver, a test voice, and ask what the caller would like to talk about. Then wait for the caller.";

function sessionConfig({ forAccept }) {
  const s = {
    model: LIVE_MODEL,
    instructions: VOICE_INSTRUCTIONS,
    delegation: { type: "client" },
    audio: { output: { voice: cfg.voice } },
    input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: GREETING }] }],
  };
  if (forAccept) s.type = "live"; // accept() requires it; create() takes the bare media config
  return s;
}

// ---- OpenAI REST ----
async function openai(path, body, { method = "POST", timeoutMs = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(OPENAI + path, {
      method, signal: ctl.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!r.ok) throw new Error(`OpenAI ${method} ${path} -> ${r.status}: ${(json?.error?.message || text || "").slice(0, 300)}`);
    return json;
  } finally { clearTimeout(t); }
}

// ---- commentary chunking: 500-token append limit; 400 UTF-8 bytes is the console sample's bound ----
function chunkForAppend(text, maxBytes = 400) {
  const out = []; let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + " " + word : word;
    if (Buffer.byteLength(next, "utf8") > maxBytes && cur) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// ---- session log (text + timings only; no audio; gitignored logs/voice/) ----
const LOG_DIR = join(ROOT, "logs", "voice");
await mkdir(LOG_DIR, { recursive: true });

// ---- the bridge: one GPT-Live session <-> one mind ----
const sessions = new Map();

// One spare mind stays warm so a call never waits on a cold start (9-17 s on ITHELAST19, while the
// first question lands ~10 s into a call). A call takes the spare and a new one warms behind it.
const newMind = () => { const m = new LiveMind(cfg.mindModel, MIND_PERSONA, { effort: cfg.mindEffort, thinking: false, timeoutMs: 60000 }); m.start(); return m; };
let spareMind = newMind();
const takeMind = () => {
  const m = spareMind; // a spare whose process died restarts lazily on its first ask
  spareMind = newMind();
  return m;
};

// ---- the party line (Telnyx conference around one GPT-Live leg); see party-line.mjs ----
const LINE_LOG = join(LOG_DIR, `partyline-${new Date().toISOString().slice(0, 10)}.jsonl`);
const lineLog = (type, data = {}) => {
  const row = { t: Date.now(), type, ...data };
  appendFile(LINE_LOG, JSON.stringify(row) + "\n").catch(() => {});
  console.log("[line]", type, data.from ?? data.humans ?? data.reason ?? data.error ?? "");
};
// an armed being's phone line stays off until its callers are pinned (EW_VOICE_CALLERS_<BEING>)
const partyLine = (cfg.telnyxKey && cfg.telnyxAppId && cfg.telnyxNumber && cfg.openaiProjectId && (!BEING || BEING.callers.length))
  ? new PartyLine({ apiKey: cfg.telnyxKey, appId: cfg.telnyxAppId, number: cfg.telnyxNumber, openaiProjectId: cfg.openaiProjectId, log: lineLog, confirmViaApi: !cfg.telnyxPublicKey, allowedCallers: BEING ? BEING.callers : [],
      onRoster: (count, info) => {
        // tell the mind's voice who is in the room; the newest SIP session is the line's AI leg
        const s = [...sessions.values()].filter((x) => x.kind === "sip" && !x.closed).sort((a, b) => b.startedAt - a.startedAt)[0];
        if (!s) return;
        const text = info.joined && count > 1 ? `Another caller just joined the line; there are now ${count} people. Greet the newcomer in one short sentence, then continue.`
          : info.left && count >= 1 ? `A caller just left the line; ${count} ${count === 1 ? "person remains" : "people remain"}. Carry on without comment unless asked.` : null;
        if (text) s.send({ type: "session.instructions.append", event_id: `roster_${randomUUID()}`, delegation_id: null, content: text });
      } })
  : null;

class BridgeSession {
  constructor(id, kind) {
    this.id = id; this.kind = kind; this.startedAt = Date.now();
    this.ws = null; this.closed = false; this.seconds = 0; this.closeReason = null;
    this.ledger = [];              // { role: "user"|"voice", text, startMs }
    this.userCursor = 0;           // ledger index: user text before this was already answered
    this.voiceCursor = 0;          // ledger index: voice text before this was already reported
    this.lastInputAt = 0;
    this.active = null;            // { delegationId, startedAt, firstSentenceMs, sentences }
    this.turns = [];               // completed turn timings for /sessions
    this.pendingDelegation = null; // settle timer handle
    this.logFile = join(LOG_DIR, `gptlive-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}-${id.slice(-6)}.jsonl`);
    this.mind = takeMind(); // already warm, so the first delegated turn is not a cold start
    this.log("session-start", { version: VERSION, kind, voice: cfg.voice, mind: cfg.mindModel, effort: cfg.mindEffort, liveModel: LIVE_MODEL });
    sessions.set(id, this);
  }

  log(type, data = {}) {
    const row = { t: Date.now(), type, ...data };
    appendFile(this.logFile, JSON.stringify(row) + "\n").catch(() => {});
    if (type !== "transcript") console.log(`[${this.id.slice(-6)}] ${type}`, data.text ?? data.ms ?? data.reason ?? data.error ?? "");
  }

  // The attach endpoint can answer 503 for a moment after the session is created: retry with
  // backoff, log the rejection body, and give up loudly (hang up) rather than leave a mouth with no mind.
  attach(attempt = 1) {
    if (this.closed) return;
    const url = `${OPENAI.replace("https://", "wss://")}/live/sessions/${encodeURIComponent(this.id)}/attach`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, handshakeTimeout: 15000, maxPayload: 1024 * 1024 });
    this.ws = ws;
    ws.on("unexpected-response", (req, res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => {
        this.log("sideband-rejected", { status: res.statusCode, body: body.slice(0, 300), attempt });
        try { req.destroy(); } catch { /* fine */ }
        const retryable = res.statusCode === 503 || res.statusCode === 429 || res.statusCode >= 500;
        if (!this.closed && retryable && attempt < 8) setTimeout(() => this.attach(attempt + 1), Math.min(4000, 400 * 2 ** (attempt - 1)));
        else this.abandon(`sideband rejected (${res.statusCode})`);
      });
    });
    ws.on("open", () => { this.attachedOnce = true; this.log("sideband-open", { attempt }); });
    ws.on("message", (buf) => { let ev; try { ev = JSON.parse(buf.toString()); } catch { return; } this.handle(ev); });
    ws.on("error", (e) => this.log("sideband-error", { error: String(e.message || e), attempt }));
    ws.on("close", (code) => {
      if (this.ws !== ws) return; // superseded by a retry
      this.log("sideband-closed", { code });
      if (this.attachedOnce) this.finish(this.closeReason || "connection_lost");
    });
    if (attempt === 1) {
      // cost guard: a forgotten tab or a stuck call cannot run for hours
      this.guard = setTimeout(() => { this.log("max-minutes-reached"); this.close(); }, cfg.maxMinutes * 60 * 1000);
    }
  }

  // no mind could be attached: end the call rather than let GPT-Live improvise alone
  async abandon(reason) {
    this.log("abandon", { reason });
    try { await openai(`/live/sessions/${encodeURIComponent(this.id)}/hangup`, undefined, { timeoutMs: 5000 }); this.log("hangup-sent"); }
    catch (e) { this.log("hangup-failed", { error: String(e.message || e) }); }
    this.finish(reason);
  }

  send(ev) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(ev)); return true;
  }

  handle(ev) {
    switch (ev.type) {
      case "session.started":
        this.log("session.started");
        // the prompting guide: repeat the greeting once through commentary after start
        this.send({ type: "session.commentary.append", event_id: "greeting_" + randomUUID(), delegation_id: null, content: GREETING });
        break;
      case "session.input_transcript.delta":
        this.ledger.push({ role: "user", text: ev.delta || "", startMs: ev.start_ms });
        this.lastInputAt = Date.now();
        this.log("transcript", { role: "user", text: ev.delta });
        if (MEMORY) this.scheduleRecall();
        break;
      case "session.output_transcript.delta":
        this.ledger.push({ role: "voice", text: ev.delta || "", startMs: ev.start_ms });
        this.log("transcript", { role: "voice", text: ev.delta });
        break;
      case "session.delegation.created": {
        const d = ev.delegation || {};
        if (d.target && d.target !== "client") return;
        this.log("delegation", { delegationId: d.id, offsetMs: ev.offset_ms });
        this.scheduleDelegation(d.id);
        break;
      }
      case "session.commentary.appended":
      case "session.thinking.appended":
      case "session.instructions.appended":
        this.log("ack", { of: ev.type, clientEventId: ev.client_event_id, startMs: ev.start_ms, endMs: ev.end_ms });
        break;
      case "session.usage.updated":
        this.seconds = ev.usage?.seconds ?? this.seconds;
        break;
      case "session.closed":
        this.seconds = ev.usage?.seconds ?? this.seconds;
        this.closeReason = ev.reason || "closed";
        this.log("session.closed", { reason: this.closeReason, seconds: this.seconds });
        this.finish(this.closeReason);
        break;
      case "error":
        this.log("live-error", { error: ev.error?.message, code: ev.error?.code, clientEventId: ev.error?.client_event_id });
        break;
      default:
        if (ev.type && !/^session\.(input|output)_audio/.test(ev.type)) this.log("event", { of: ev.type });
    }
  }

  // The delegation event carries no words: wait for the transcript to settle (deltas lag speech),
  // then hand everything the caller said since the last answered turn to the mind.
  scheduleDelegation(delegationId) {
    if (this.pendingDelegation) clearTimeout(this.pendingDelegation.timer);
    const begun = Date.now();
    const tick = () => {
      const quiet = Date.now() - this.lastInputAt;
      if (quiet >= 250 || Date.now() - begun >= 800) { this.pendingDelegation = null; this.runDelegation(delegationId); }
      else this.pendingDelegation.timer = setTimeout(tick, 60);
    };
    this.pendingDelegation = { delegationId, timer: setTimeout(tick, 60) };
  }

  async runDelegation(delegationId) {
    let userText = this.ledger.slice(this.userCursor).filter((r) => r.role === "user").map((r) => r.text).join("").trim();
    const voiceText = this.ledger.slice(this.voiceCursor).filter((r) => r.role === "voice").map((r) => r.text).join("").trim();
    this.userCursor = this.ledger.length; this.voiceCursor = this.ledger.length;

    if (this.active) { // a new delegation while the mind is still talking: the caller moved on
      this.active.stale = true;
      try { this.mind.interrupt?.(); } catch { /* fine */ }
      this.log("interrupt", { delegationId: this.active.delegationId });
    }
    const turn = { delegationId, startedAt: Date.now(), firstSentenceMs: null, sentences: 0, stale: false };
    this.active = turn;

    // the recall started while the caller spoke: wait up to 1 s for it (0.8-2 s per call), else answer without
    if (MEMORY && this.recallPending) {
      const memories = await Promise.race([this.recallPending, new Promise((r) => setTimeout(() => r(""), 1000))]);
      this.recallPending = null;
      if (memories) userText = `Memories that may be relevant:\n${memories}\n\nAlan said: ${userText}`;
    }

    let ask = userText || "[The caller spoke, but nothing was transcribed. Ask them, briefly, to say it again.]";
    if (voiceText) ask = `[What the voice said aloud since your last reply: "${voiceText.slice(0, 400)}"]\n${ask}`;
    if (MEMORY && !this.oriented) { // the waking's orientation rides the first real turn (the greeting is instant and fixed)
      this.oriented = true;
      const o = MEMORY.orient();
      if (o) ask = `[Call orientation, from orient.mjs. The spoken practice: let Alan hear that time has passed, briefly, if it fits your reply.\n${o}]\n${ask}`;
    }
    this.log("mind-ask", { delegationId, text: ask });

    try {
      const full = await this.mind.ask(ask, (sentence) => {
        if (turn.stale || this.closed) return;
        if (turn.firstSentenceMs === null) turn.firstSentenceMs = Date.now() - turn.startedAt;
        for (const content of chunkForAppend(sentence)) {
          turn.sentences++;
          this.send({ type: "session.commentary.append", event_id: `c_${randomUUID()}`, delegation_id: delegationId, content });
        }
        this.log("commentary", { delegationId, text: sentence, ms: Date.now() - turn.startedAt });
      });
      if (!turn.stale) this.log("mind-reply", { delegationId, text: full, firstSentenceMs: turn.firstSentenceMs, totalMs: Date.now() - turn.startedAt });
    } catch (e) {
      this.log("mind-error", { delegationId, error: String(e.message || e) });
      if (!turn.stale && !this.closed) {
        this.send({ type: "session.commentary.append", event_id: `c_${randomUUID()}`, delegation_id: delegationId, content: "Sorry, I lost my train of thought for a moment. Could you say that again?" });
      }
    } finally {
      if (this.active === turn) this.active = null;
      this.turns.push({ delegationId, firstSentenceMs: turn.firstSentenceMs, totalMs: Date.now() - turn.startedAt, sentences: turn.sentences, stale: turn.stale });
    }
  }

  close() {
    if (this.closed) return;
    if (!this.send({ type: "session.close", event_id: "close_" + randomUUID() })) this.finish("close_requested");
    else setTimeout(() => { if (!this.closed) { this.log("close-timeout"); this.finish("close_requested"); } }, 12000);
  }

  finish(reason) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.guard);
    if (this.pendingDelegation) clearTimeout(this.pendingDelegation.timer);
    try { this.mind.interrupt?.(); } catch { /* fine */ }
    // D50: a call Alan actually spoke in becomes an episode, written by the being itself before its mind closes
    if (MEMORY && this.turns.some((t) => t.sentences)) this.writeback(this.mind);
    else this.mind.stop();
    try { this.ws?.close(); } catch { /* fine */ }
    this.log("session-end", { reason, seconds: this.seconds, turns: this.turns.length });
    sessions.delete(this.id);
  }

  scheduleRecall() {
    clearTimeout(this.recallTimer);
    this.recallTimer = setTimeout(() => {
      const q = this.ledger.slice(this.userCursor).filter((r) => r.role === "user").map((r) => r.text).join("").trim();
      if (q.length < 8) return;
      const t0 = Date.now();
      this.recallPending = MEMORY.recall(q).then(
        (m) => { this.log("recall", { ms: Date.now() - t0, hits: m ? m.split("\n").length : 0 }); return m; },
        (e) => { this.log("recall-failed", { error: String(e.message || e) }); return ""; });
    }, 400); // one recall per pause in speech, not one per transcript delta
  }

  async writeback(mind) {
    try {
      const fmt = (t, o) => new Intl.DateTimeFormat("en-CA", { timeZone: env.EDGEWEAVER_TZ || "America/New_York", ...o }).format(new Date(t));
      const hm = (t) => fmt(t, { hour: "2-digit", minute: "2-digit", hour12: false });
      const prefix = `${fmt(this.startedAt, { year: "numeric", month: "2-digit", day: "2-digit" })}, ${hm(this.startedAt)} to ${hm(Date.now())}, voice call:`;
      const reply = await mind.ask(`[The call has ended. Write your episode of this call for your own memory, the way you write episodes on Telegram: one compact paragraph of what actually happened and what mattered, plain text, starting exactly with "${prefix}". Then one last line: IMPORTANCE: <1-10>.]`, () => {});
      const imp = reply.match(/IMPORTANCE:\s*(\d+)/i);
      const content = reply.replace(/\s*IMPORTANCE:[\s\S]*$/i, "").trim();
      const r = await MEMORY.writeEpisode({ content, importance: imp ? Math.min(10, Math.max(1, Number(imp[1]))) : 5, sessionId: this.id.slice(-8) });
      this.log("episode-written", { id: r.id, proved: r.proved, embedded: r.embedded, voided: r.voided, skipped: r.skipped, mode: MEMORY.mode, text: content });
    } catch (e) { this.log("episode-failed", { error: String(e.message || e) }); }
    finally { mind.stop(); }
  }

  status() {
    return { id: this.id, kind: this.kind, seconds: this.seconds, startedAt: this.startedAt, closed: this.closed,
      turns: this.turns.slice(-10), active: this.active ? { delegationId: this.active.delegationId, sinceMs: Date.now() - this.active.startedAt } : null };
  }
}

// ---- webhook signature (Standard Webhooks: HMAC-SHA256 over "id.timestamp.body", whsec_ base64 key) ----
function verifyWebhook(headers, rawBody, secret) {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
  if (!id || !ts || !sig || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return String(sig).split(" ").some((part) => {
    const [v, b64] = part.split(",");
    if (v !== "v1" || !b64) return false;
    let got; try { got = Buffer.from(b64, "base64"); } catch { return false; }
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ---- HTTP ----
const PAGE = await readFile(join(HERE, "gpt-live-page.html"), "utf8");
const ttsCache = new Map(); // test speech, per question
const readBody = (req) => new Promise((res, rej) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => res(b)); req.on("error", rej); });
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
// EW_VOICE_ROUTES: other beings' lines served by sibling bridges, "+1NUMBER=http://127.0.0.1:PORT,..."
const voiceRoutes = () => (env.EW_VOICE_ROUTES || "").split(",").map((r) => r.trim().split("="))
  .filter(([num, to]) => num && to).map(([num, to]) => [num, to.replace(/\/$/, "")]);
const pick = (h, keys) => Object.fromEntries(keys.filter((k) => h[k]).map((k) => [k, h[k]]));
const gated = (url) => !cfg.pageToken || url.searchParams.get("k") === cfg.pageToken;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      if (!gated(url)) return json(res, 403, { error: "page token required (?k=)" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE.replaceAll("__WHO__", WHO).replace("__VERSION__", VERSION).replace("__MIND__", `${cfg.mindModel} (${cfg.mindEffort})`).replace("__VOICE__", cfg.voice));
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, version: VERSION, openaiKey: !!cfg.apiKey, webhookSecret: !!cfg.webhookSecret, mind: cfg.mindModel, effort: cfg.mindEffort, voice: cfg.voice, sessions: sessions.size, testMode: true, persona: BEING ? `${BEING.being} (memory ${MEMORY ? MEMORY.mode : "off"}, soul ${BEING.soulHead})` : cfg.personaFile ? "file" : "testweaver", partyLine: !!partyLine, telnyxVerify: cfg.telnyxPublicKey ? "ed25519" : cfg.telnyxWebhookToken ? "url-token+api-confirm" : "none" });
    }
    if (req.method === "GET" && url.pathname === "/sessions") {
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      return json(res, 200, { sessions: [...sessions.values()].map((s) => s.status()), line: partyLine ? partyLine.status() : null });
    }
    if (req.method === "GET" && url.pathname === "/selftest") {
      // the plan-side brain, no OpenAI: proves the mind answers and how fast
      const mind = new LiveMind(cfg.mindModel, MIND_PERSONA, { effort: cfg.mindEffort, thinking: false, timeoutMs: 60000 });
      const t0 = Date.now(); mind.start();
      try {
        await mind.ask("Say hello in three words.", () => {});
        const warmMs = Date.now() - t0; const t1 = Date.now(); let first = null;
        const reply = await mind.ask(url.searchParams.get("q") || "What's a good way to start a morning?", () => { if (first === null) first = Date.now() - t1; });
        return json(res, 200, { ok: true, mind: cfg.mindModel, effort: cfg.mindEffort, coldStartMs: warmMs, firstSentenceMs: first, totalMs: Date.now() - t1, reply });
      } catch (e) { return json(res, 500, { ok: false, error: String(e.message || e) }); }
      finally { mind.stop(); }
    }
    if (req.method === "GET" && url.pathname === "/api/test-speech") {
      // test-only: a synthesized spoken question as WAV, so the page can "speak" without a microphone
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      const q = url.searchParams.get("q") || "What is a good way to start a morning?";
      if (!ttsCache.has(q)) {
        const r = await fetch(`${OPENAI}/audio/speech`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: q, response_format: "wav" }) });
        if (!r.ok) return json(res, 502, { error: `tts ${r.status}: ${(await r.text()).slice(0, 200)}` });
        ttsCache.set(q, Buffer.from(await r.arrayBuffer()));
      }
      res.writeHead(200, { "content-type": "audio/wav", "cache-control": "no-store" });
      return res.end(ttsCache.get(q));
    }
    if (req.method === "POST" && url.pathname === "/api/session") {
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      const { sdp } = JSON.parse(await readBody(req) || "{}");
      if (!sdp) return json(res, 400, { error: "sdp required" });
      const created = await openai("/live/sessions", { session: sessionConfig({ forAccept: false }), transport: { type: "webrtc", sdp } });
      const id = created?.session?.id;
      if (!id || !created?.transport?.sdp) throw new Error("create returned no session id or answer sdp");
      const s = new BridgeSession(id, "webrtc"); s.attach();
      return json(res, 200, { sessionId: id, sdp: created.transport.sdp });
    }
    if (req.method === "GET" && url.pathname === "/api/session-config") {
      // test-only: the exact session config, so the e2e script starts a session the way the server would
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      return json(res, 200, { session: sessionConfig({ forAccept: false }) });
    }
    if (req.method === "POST" && url.pathname === "/api/session/attach") {
      // test-only: bridge a session the caller already created (e2e script on the primary WebSocket)
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      const { sessionId, kind } = JSON.parse(await readBody(req) || "{}");
      if (!sessionId) return json(res, 400, { error: "sessionId required" });
      if (sessions.has(sessionId)) return json(res, 200, { ok: true, already: true });
      const s = new BridgeSession(sessionId, kind || "attached"); s.attach();
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/session/close") {
      if (!gated(url)) return json(res, 403, { error: "page token required" });
      const { sessionId } = JSON.parse(await readBody(req) || "{}");
      const s = sessions.get(sessionId); if (s) s.close();
      return json(res, 200, { ok: !!s });
    }
    if (req.method === "POST" && url.pathname.startsWith("/webhooks/telnyx")) {
      const raw = await readBody(req);
      // authenticity: Ed25519 signature when the account has a public key; otherwise the secret URL
      // token (and the party line confirms each call event against the Telnyx API before acting)
      let authentic = false;
      if (cfg.telnyxPublicKey) authentic = url.pathname === "/webhooks/telnyx" && verifyTelnyx(req.headers, raw, cfg.telnyxPublicKey);
      else if (cfg.telnyxWebhookToken) authentic = url.pathname === `/webhooks/telnyx/${cfg.telnyxWebhookToken}`;
      else { console.error("telnyx webhook received but neither TELNYX_PUBLIC_KEY nor TELNYX_WEBHOOK_TOKEN is set; refusing"); return json(res, 503, { error: "telnyx webhook verification not configured" }); }
      if (!authentic) return json(res, 404, { error: "not found" });
      let ev; try { ev = JSON.parse(raw); } catch { return json(res, 400, { error: "bad json" }); }
      // The account level allows ONE Call Control app, so every being's number sits on it and its
      // webhooks land here: a call to or from another being's number goes to that being's bridge;
      // conference events carry no number, so every bridge sees them and each acts only on its own.
      const tev = ev.data || ev; const p = tev.payload || {};
      const fwd = (to) => fetch(to + url.pathname, { method: "POST", headers: { "content-type": "application/json", ...pick(req.headers, ["telnyx-signature-ed25519", "telnyx-timestamp"]) }, body: raw })
        .catch((e) => console.error(`telnyx route to ${to} failed:`, e.message));
      const routed = voiceRoutes().find(([num]) => p.to === num || p.from === num);
      if (routed) { json(res, 200, { ok: true, routed: true }); fwd(routed[1]); return; }
      if (String(tev.event_type || "").startsWith("conference.")) for (const [, to] of voiceRoutes()) fwd(to);
      if (!partyLine) return json(res, 503, { error: "party line not configured (TELNYX_API_KEY, TELNYX_APP_ID, TELNYX_NUMBER, OPENAI_PROJECT_ID, callers)" });
      json(res, 200, { ok: true }); // answer fast; Telnyx retries slow endpoints
      partyLine.handle(ev.data || ev).catch((e) => lineLog("line-error", { error: String(e.message || e) }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/webhooks/openai") {
      const raw = await readBody(req);
      if (!cfg.webhookSecret) { console.error("webhook received but OPENAI_WEBHOOK_SECRET is not set; refusing"); return json(res, 503, { error: "webhook secret not configured" }); }
      if (!verifyWebhook(req.headers, raw, cfg.webhookSecret)) return json(res, 400, { error: "bad signature" });
      let ev; try { ev = JSON.parse(raw); } catch { return json(res, 400, { error: "bad json" }); }
      json(res, 200, { ok: true }); // answer fast; OpenAI retries anything slow
      const t = ev.type; const d = ev.data || {};
      // One OpenAI project webhook serves every line: a SIP leg dialled from another being's number
      // (its party line's From) goes to that being's bridge (EW_VOICE_ROUTES "+1...=http://127.0.0.1:8799,..."),
      // which verifies the same signature itself. Each child only ever answers on its own line.
      const fromHdr = d.sip_headers?.find?.((h) => /^from$/i.test(h.name))?.value || "";
      const route = voiceRoutes().find(([num]) => fromHdr.includes(num.replace(/^\+/, "")));
      if (route) {
        try { await fetch(route[1] + "/webhooks/openai", { method: "POST", headers: { "content-type": "application/json", "webhook-id": req.headers["webhook-id"] || "", "webhook-timestamp": req.headers["webhook-timestamp"] || "", "webhook-signature": req.headers["webhook-signature"] || "" }, body: raw }); console.log(`[call] routed ${t} for ${route[0]} to ${route[1]}`); }
        catch (e) { console.error(`route to ${route[1]} failed:`, e.message); }
        return;
      }
      if ((t === "live.transport.incoming" || t === "live.call.incoming") && (d.type === "sip" || !d.type) && d.session_id) {
        if (sessions.has(d.session_id)) return;
        const from = d.sip_headers?.find?.((h) => /^from$/i.test(h.name))?.value; // untrusted caller metadata, log only
        console.log(`[call] incoming SIP session ${d.session_id.slice(-6)} from ${from || "?"}`);
        try {
          await openai(`/live/sessions/${encodeURIComponent(d.session_id)}/accept`, { session: sessionConfig({ forAccept: true }) });
          const s = new BridgeSession(d.session_id, "sip"); s.log("sip-from", { from: from || null }); s.attach();
        } catch (e) { console.error("accept failed:", e.message); }
      } else if (t === "realtime.call.incoming") {
        console.log("[call] ignoring realtime.call.incoming (GPT-Live handler owns the decision)");
      } else {
        console.log("[webhook] ignored event", t);
      }
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    console.error(req.method, url.pathname, "->", e.message);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(cfg.port, "0.0.0.0", () => {
  console.log(`${WHO} on GPT-Live ${VERSION}: http://127.0.0.1:${cfg.port}  mind=${cfg.mindModel}/${cfg.mindEffort} voice=${cfg.voice} webhookSecret=${cfg.webhookSecret ? "set" : "MISSING (phone calls refused)"} pageToken=${cfg.pageToken ? "set" : "none"} partyLine=${partyLine ? "armed" : "off (telnyx env missing)"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { spareMind.stop(); for (const s of sessions.values()) s.close(); if (partyLine) partyLine.shutdown().catch(() => {}); setTimeout(() => process.exit(0), 2500); });
