// gpt-live-e2e.mjs - synthetic caller for the GPT-Live bridge: no human, no mic.
// Synthesizes a spoken question (OpenAI TTS -> 24 kHz PCM), opens a PRIMARY GPT-Live WebSocket
// with the server's own session config, asks the server to bridge it (sideband + mind), streams
// the question as if spoken, then reports what was heard and how fast. Spends a few cents.
// Usage: node scripts/test-mode/gpt-live-e2e.mjs ["question"]   (server must be running)
// LIMIT (measured 2026-10-23): a session whose PRIMARY transport is this WebSocket refuses the server's
// sideband attach (HTTP 503, 8 tries), so the bridge never joins and the voice only fillers. This script
// therefore proves hearing + delegation only. The real end-to-end check is the browser page in
// synthetic mode: http://127.0.0.1:8797/?synthetic=1 (WebRTC primary, sideband attaches fine).
import WebSocket from "ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries((await readFile(join(HERE, "..", "..", ".env.local"), "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const KEY = env.OPENAI_API_KEY;
const SERVER = `http://127.0.0.1:${env.EW_GPTLIVE_PORT || 8797}`;
const QS = env.EW_GPTLIVE_PAGE_TOKEN ? `?k=${env.EW_GPTLIVE_PAGE_TOKEN}` : "";
const QUESTION = process.argv[2] || "What is a good way to start a morning?";
const RATE = 24000, CHUNK_MS = 100, CHUNK_BYTES = RATE * 2 * CHUNK_MS / 1000;

const t0 = Date.now(); const ms = () => Date.now() - t0;
const out = { question: QUESTION, events: [], inputTranscript: "", outputTranscript: "", greeting: "", answer: "", audioBytes: 0, delegationAt: null, questionEndAt: null, firstAnswerWordAt: null, usageSeconds: null, closedReason: null, startedRaw: null };
const note = (s, extra) => { out.events.push({ ms: ms(), s, ...(extra || {}) }); console.error(`${String(ms()).padStart(6)}ms ${s}${extra ? " " + JSON.stringify(extra) : ""}`); };

// 1. the spoken question
const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: QUESTION, response_format: "pcm" }) });
if (!ttsRes.ok) { console.error("tts failed", ttsRes.status, (await ttsRes.text()).slice(0, 300)); process.exit(1); }
const speech = Buffer.from(await ttsRes.arrayBuffer());
note("tts ready", { bytes: speech.length, seconds: +(speech.length / (RATE * 2)).toFixed(2) });

// 2. the session config the server itself uses
const { session } = await (await fetch(`${SERVER}/api/session-config${QS}`)).json();
session.audio = { ...(session.audio || {}), format: { type: "audio/pcm", rate: RATE } };

// 3. primary WebSocket
const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${KEY}` } });
let sessionId = null, phase = "greeting", lastOutAt = 0, sendTimer = null, speechOffset = 0, closing = false;
const silence = Buffer.alloc(CHUNK_BYTES);
const send = (ev) => ws.send(JSON.stringify(ev));
const finish = () => {
  if (closing) return; closing = true; clearInterval(sendTimer);
  note("closing"); send({ type: "session.close", event_id: "close_1" });
  setTimeout(() => { note("close timeout"); done(); }, 12000);
};
const done = () => {
  out.greeting = out.greeting.trim(); out.answer = out.answer.trim();
  out.firstWordMsFromQuestionEnd = out.firstAnswerWordAt && out.questionEndAt ? out.firstAnswerWordAt - out.questionEndAt : null;
  out.delegationMsFromQuestionEnd = out.delegationAt && out.questionEndAt ? out.delegationAt - out.questionEndAt : null;
  console.log(JSON.stringify(out, null, 1)); process.exit(0);
};

ws.on("open", () => { note("ws open"); send({ type: "session.start", event_id: "start_1", session }); });
ws.on("error", (e) => { note("ws error", { error: String(e.message || e) }); });
ws.on("close", (code) => { note("ws closed", { code }); if (!closing) { out.closedReason = out.closedReason || `ws ${code}`; done(); } });
ws.on("message", async (buf) => {
  let ev; try { ev = JSON.parse(buf.toString()); } catch { return; }
  switch (ev.type) {
    case "session.started": {
      sessionId = ev.session?.id || ev.session_id || ev.id || null; out.startedRaw = ev;
      note("session.started", { sessionId });
      const r = await fetch(`${SERVER}/api/session/attach${QS}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, kind: "e2e" }) });
      note("bridge attach", await r.json());
      // stream continuously: silence while the greeting plays, then the question, then silence
      sendTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || closing) return;
        if (phase === "greeting" && (lastOutAt ? Date.now() - lastOutAt > 1500 : ms() > 7000)) { phase = "question"; note("speaking the question"); }
        let chunk = silence;
        if (phase === "question") {
          chunk = speech.subarray(speechOffset, speechOffset + CHUNK_BYTES); speechOffset += CHUNK_BYTES;
          if (chunk.length < CHUNK_BYTES) { chunk = Buffer.concat([chunk, Buffer.alloc(CHUNK_BYTES - chunk.length)]); phase = "waiting"; out.questionEndAt = ms(); note("question finished"); }
        }
        send({ type: "session.input_audio.append", audio: chunk.toString("base64") });
        if (phase === "waiting" && ms() - out.questionEndAt > 25000) { note("no answer within 25s"); finish(); }
        if (phase === "answering" && Date.now() - lastOutAt > 3500) { note("answer settled"); finish(); }
      }, CHUNK_MS);
      break;
    }
    case "session.input_transcript.delta": out.inputTranscript += ev.delta || ""; break;
    case "session.output_transcript.delta":
      out.outputTranscript += ev.delta || ""; lastOutAt = Date.now();
      if (phase === "greeting") out.greeting += ev.delta || "";
      else if (phase === "waiting" || phase === "answering") {
        if (phase === "waiting") { phase = "answering"; out.firstAnswerWordAt = ms(); note("first answer transcript", { delta: ev.delta }); }
        out.answer += ev.delta || "";
      }
      break;
    case "session.output_audio.delta": out.audioBytes += Buffer.from(ev.delta || "", "base64").length; break; // continuous stream, silence included: not a liveness signal
    case "session.delegation.created": out.delegationAt = ms(); note("delegation.created", { id: ev.delegation?.id, target: ev.delegation?.target }); break;
    case "session.usage.updated": out.usageSeconds = ev.usage?.seconds ?? out.usageSeconds; break;
    case "session.closed": out.usageSeconds = ev.usage?.seconds ?? out.usageSeconds; out.closedReason = ev.reason; note("session.closed", { reason: ev.reason, seconds: out.usageSeconds }); done(); break;
    case "error": note("live error", { error: ev.error?.message, code: ev.error?.code, param: ev.error?.param }); if (phase === "greeting" && !sessionId) { out.closedReason = "start error"; done(); } break;
    default: if (!/audio/.test(ev.type)) note("event " + ev.type);
  }
});
setTimeout(() => { note("hard stop at 90s"); finish(); }, 90000);
