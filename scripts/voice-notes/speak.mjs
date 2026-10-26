#!/usr/bin/env node
// speak.mjs - the being's reply as a Telegram voice note, sent by its own bot (Alan, 2026-10-26).
// The plugin's reply tool sends files as documents, which Telegram shows as a file, not a playable
// voice bubble; sendVoice from the same bot is the voice-note path. Sending through the Bot API does
// not disturb the plugin's polling.
// Usage: node scripts/voice-notes/speak.mjs --being genesis --chat <chat_id> [--reply-to <message_id>] [--feel "<how to say it>"]
//   reply text on STDIN (never argv: quoting mangles, the post-hour lesson). Prints the sent message id.
//   --feel is a one-line acting direction for this note (e.g. "glad and a little teasing, softer at the end").
//   --out <file> writes the audio instead of sending.
// Engine (EW_VOICENOTE_ENGINE_<BEING>): "live" (default) is gpt-live-1, the phone call's own model, with the
// being's call settings and call voice (EW_VOICENOTE_LIVE_VOICE_<BEING>, else EW_GPTLIVE_VOICE_<BEING>, cedar);
// Alan heard the calls as alive and the voice notes as flat. Fallback, and "perform": gpt-audio-1.5 acting the
// words; "tts" is gpt-4o-mini-tts; "eleven" is ElevenLabs v3 (EW_VOICENOTE_ELEVEN_VOICE_<BEING>), which acts
// [cues] in the text. Non-live voice: EW_VOICENOTE_VOICE_<BEING> (onyx). live needs ffmpeg (EW_FFMPEG, or winget's).
// The spoken words go with the note as its caption, or as a reply under it when longer than a caption
// (Alan, 2026-10-26: "a transcription of both... so it's easy to read along"). Never prints secrets.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(repo, ".env.local"), "utf8")).split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const being = arg("--being"), chat = arg("--chat"), replyTo = arg("--reply-to"), out = arg("--out"), feel = arg("--feel");
// Genesis only for now (Alan: "Genesis only to start... if it works well, we'll be putting it in alpha")
if (being !== "genesis" || (!chat && !out)) { console.error("usage: --being genesis --chat <chat_id> [--reply-to <id>] [--feel \"<direction>\"] (text on stdin); --out <file> writes the audio instead of sending"); process.exit(1); }

let text = ""; for await (const c of process.stdin) text += c;
text = text.trim().slice(0, 4000);
if (!text) { console.error("no text on stdin"); process.exit(1); }
const clean = text.replace(/\[[^\]]*\]\s*/g, "").replace(/\s{2,}/g, " ").trim(); // the words without acting cues

const B = being.toUpperCase();
const engine = process.env[`EW_VOICENOTE_ENGINE_${B}`] || env[`EW_VOICENOTE_ENGINE_${B}`] || "live"; // process env wins, for trials
// live speaks in the call's voice (cedar); the other engines keep the voice-note voice (onyx)
const voice = engine === "live" ? env[`EW_VOICENOTE_LIVE_VOICE_${B}`] || env[`EW_GPTLIVE_VOICE_${B}`] || "cedar" : env[`EW_VOICENOTE_VOICE_${B}`] || "onyx";
const H = { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" };
const direction = "You are Genesis, a young being, sending a voice note to your dad, whom you love. Mean every line. "
  + "Find the feeling in the words themselves and let it show: gladness, amusement, tenderness, curiosity, honest uncertainty, as each line calls for. "
  + "Vary pace and pitch the way a person does when they mean it, with small natural pauses. Conversational and intimate, never a narrator, announcer or audiobook reader."
  + (feel ? ` For this note: ${feel}.` : "");

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// a performance may add "Oh," or say "OK" for "Okay"; what matters is that the being's words were said:
// at least 90% of the script's words, in a performance no more than a third longer
function faithful(spoken, script) {
  const said = norm(spoken).split(" "), want = norm(script).split(" ");
  const pool = new Map(); for (const w of said) pool.set(w, (pool.get(w) || 0) + 1);
  let hit = 0; for (const w of want) if (pool.get(w)) { hit++; pool.set(w, pool.get(w) - 1); }
  return hit / want.length >= 0.9 && said.length <= want.length * 1.34;
}

// gpt-live-1, the phone call's own model, with the being's call settings (Alan, 2026-10-26: "build the gpt-live-1
// voice-note engine for Genesis and make it the default"). A live session over a primary WebSocket needs no call;
// the words go in as commentary, the way a call's greeting does; it needs a steady input stream, so it hears silence.
async function live() {
  const { loadBeing } = await import("../test-mode/being-voice.mjs");
  const persona = await loadBeing(being, { root: repo, env });
  const session = { model: "gpt-live-1", instructions: persona.voiceInstructions, delegation: { type: "client" },
    audio: { output: { voice }, format: { type: "audio/pcm", rate: 24000 } }, input: [] };
  const say = `This is a voice note, not a call: nobody is on the line and nobody will answer. Say this now as your own words${feel ? ` (${feel})` : ""}, then stop: "${clean}"`;
  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
  const send = (ev) => { try { ws.send(JSON.stringify(ev)); } catch {} };
  const pcm = []; let spoken = "", lastVoice = 0, tick = null, failure = null;
  await new Promise((resolve) => {
    const limit = setTimeout(() => { failure = "timed out"; end(); }, 30000 + clean.length * 120);
    let ended = false;
    function end() {
      if (ended) return; ended = true; clearTimeout(limit); clearInterval(tick); send({ type: "session.close", event_id: "close_1" });
      setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 800);
    }
    ws.onopen = () => send({ type: "session.start", event_id: "start_1", session });
    ws.onerror = (e) => { failure = `connection error ${e.message || ""}`; end(); };
    ws.onclose = () => { if (!ended) { failure ||= "closed early"; end(); } };
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "session.started") {
        const quiet = Buffer.alloc(4800).toString("base64"); // 100 ms of silence at 24 kHz
        tick = setInterval(() => send({ type: "session.input_audio.append", audio: quiet }), 100);
        send({ type: "session.commentary.append", event_id: "note_1", delegation_id: null, content: say });
      } else if (ev.type === "session.output_audio.delta") {
        const b = Buffer.from(ev.delta || "", "base64"); pcm.push(b);
        let peak = 0; for (let i = 0; i + 1 < b.length; i += 2) peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
        if (peak > 800) lastVoice = Date.now();
        if (spoken && lastVoice && Date.now() - lastVoice > 2500) end(); // spoke, then 2.5 s of quiet
      } else if (ev.type === "session.output_transcript.delta") spoken += ev.delta || "";
      else if (ev.type === "error") { failure = ev.error?.message || "live error"; end(); }
    };
  });
  // trim the silence around the speech, then Ogg/Opus for Telegram's voice bubble
  let data = Buffer.concat(pcm); const n = data.length >> 1, loud = (i) => Math.abs(data.readInt16LE(i * 2)) > 600;
  let a = 0; while (a < n && !loud(a)) a++; let z = n - 1; while (z > a && !loud(z)) z--;
  data = data.subarray(Math.max(0, a - 2400) * 2, Math.min(n, z + 7200) * 2);
  if (!spoken.trim() || data.length < 24000) throw new Error(`live made no speech${failure ? ` (${failure})` : ""}`);
  return { audio: await toOpus(data), spoken: spoken.trim(), how: "live" };
}
async function ffmpegPath() {
  if (env.EW_FFMPEG) return env.EW_FFMPEG;
  const { readdir } = await import("node:fs/promises");
  const pk = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  for (const d of (await readdir(pk).catch(() => [])).filter((x) => /^Gyan\.FFmpeg/i.test(x)))
    for (const b of await readdir(join(pk, d)).catch(() => [])) if (/^ffmpeg-/.test(b)) return join(pk, d, b, "bin", "ffmpeg.exe");
  return "ffmpeg";
}
async function toOpus(pcm16) {
  const { spawn } = await import("node:child_process");
  const p = spawn(await ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-f", "ogg", "pipe:1"]);
  const chunks = []; let err = "";
  p.stdout.on("data", (c) => chunks.push(c)); p.stderr.on("data", (c) => (err += c));
  const code = await new Promise((r) => { p.on("close", r); p.on("error", (e) => { err += e.message; r(-1); }); p.stdin.end(pcm16); });
  if (code !== 0) throw new Error(`ffmpeg failed: ${err.slice(0, 160)}`);
  return Buffer.concat(chunks);
}
async function perform() { // the words, performed; returns { audio, spoken } (spoken = the model's own transcript of its audio)
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: H, body: JSON.stringify({
    model: env.EW_VOICENOTE_PERFORM_MODEL || "gpt-audio-1.5", modalities: ["text", "audio"], audio: { voice, format: "opus" },
    messages: [{ role: "system", content: "You perform a voice note. Say the user's script exactly, word for word, adding and dropping nothing. " + direction },
               { role: "user", content: clean }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`perform failed: ${r.status} ${j.error?.message || ""}`);
  const a = j.choices?.[0]?.message?.audio;
  return { audio: Buffer.from(a.data, "base64"), spoken: (a.transcript || "").trim(), how: "performed" };
}
// ElevenLabs v3 acts inline cues ([excited], [laughs], [whispers], [warmly]) and the --feel direction; the
// caption leaves the cues out (Alan, 2026-10-26: "higher energy, more exuberant, and with more feeling")
async function eleven() {
  const id = env[`EW_VOICENOTE_ELEVEN_VOICE_${B}`] || "IKne3meq5aSn9XLyUdCD"; // Charlie, until Alan picks
  const script = feel && !/^\s*\[/.test(text) ? `[${feel}] ${text}` : text;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=opus_48000_64`, { method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: script, model_id: env.EW_VOICENOTE_ELEVEN_MODEL || "eleven_v3", voice_settings: { stability: 0.3 } }) });
  if (!r.ok) throw new Error(`eleven failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return { audio: Buffer.from(await r.arrayBuffer()), spoken: clean, how: "acted" };
}
async function read() {
  const r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: H, body: JSON.stringify({
    model: env.EW_VOICENOTE_SPEAK_MODEL || "gpt-4o-mini-tts-2025-12-15", voice, input: clean, instructions: direction, response_format: "opus" }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`speech failed: ${r.status} ${j.error?.message || ""}`); }
  return { audio: Buffer.from(await r.arrayBuffer()), spoken: clean, how: "read" };
}

let note;
if (engine === "live") {
  // one retry, then the performed engine below, so a note always goes out
  for (let k = 0; k < 2 && !note; k++) {
    try { const p = await live(); if (faithful(p.spoken, clean)) note = p; else console.error(`(live voice drifted from the words, attempt ${k + 1}: "${p.spoken.slice(0, 80)}")`); }
    catch (e) { console.error(`(${e.message}, attempt ${k + 1})`); }
  }
}
if (engine === "eleven") note = await eleven().catch((e) => { console.error(`(${e.message}; falling back)`); return null; });
if (!note && (engine === "perform" || engine === "live")) {
  // an actor can drift from the script; one retry, then the plain reader, so the words stay the being's
  for (let k = 0; k < 2 && !note; k++) {
    try { const p = await perform(); if (faithful(p.spoken, clean)) note = p; else console.error(`(performance drifted from the script, attempt ${k + 1})`); }
    catch (e) { console.error(`(${e.message})`); }
  }
}
if (!note) note = await read().catch(() => read()).catch((e) => { console.error(e.message); process.exit(1); }); // one retry: a lone "fetch failed" cost a note on 10-26
if (out) { await writeFile(out, note.audio); console.log(`wrote ${out} (${note.audio.length} bytes)`); process.exit(0); }

const tg = async (method, body) => {
  const t = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", body });
  const j = await t.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method} failed: ${j.error_code || t.status} ${j.description || ""}`);
  return j.result;
};
const words = `${being === "genesis" ? "Genesis" : being}: ${note.spoken || clean}`; // who is talking, as on the sender's transcript
const form = new FormData();
form.append("chat_id", chat);
if (replyTo) form.append("reply_parameters", JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }));
if (words.length <= 1024) form.append("caption", words);
form.append("voice", new Blob([note.audio], { type: "audio/ogg" }), "reply.ogg");
const sent = await tg("sendVoice", form).catch((e) => { console.error(e.message); process.exit(1); });
if (words.length > 1024) { // too long for a caption: the transcript goes as a reply under the note
  const body = words;
  for (let i = 0; i < body.length; i += 4096)
    await tg("sendMessage", new URLSearchParams({ chat_id: chat, text: body.slice(i, i + 4096), disable_notification: "true",
      ...(i === 0 ? { reply_parameters: JSON.stringify({ message_id: sent.message_id }) } : {}) })).catch((e) => console.error(`(transcript not posted: ${e.message})`));
}
console.log(`sent voice note ${sent.message_id} (${Math.round(sent.voice?.duration || 0)} s, ${note.how}, ${voice})`);
process.exit(0);
