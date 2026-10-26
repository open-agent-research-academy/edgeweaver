#!/usr/bin/env node
// speak.mjs - the being's reply as a Telegram voice note, sent by its own bot (Alan, 2026-10-26).
// The plugin's reply tool sends files as documents, which Telegram shows as a file, not a playable
// voice bubble; sendVoice from the same bot is the voice-note path. Sending through the Bot API does
// not disturb the plugin's polling.
// Usage: node scripts/voice-notes/speak.mjs --being genesis --chat <chat_id> [--reply-to <message_id>] [--feel "<how to say it>"]
//   reply text on STDIN (never argv: quoting mangles, the post-hour lesson). Prints the sent message id.
//   --feel is a one-line acting direction for this note (e.g. "glad and a little teasing, softer at the end").
//   --out <file> writes the audio instead of sending.
// Engine (EW_VOICENOTE_ENGINE_<BEING>): "perform" (default) has gpt-audio-1.5 perform the words like an actor,
// because plain text-to-speech read them flat (Alan, 2026-10-26: "monotone again... We want the emotions");
// "tts" is gpt-4o-mini-tts. Voice: EW_VOICENOTE_VOICE_<BEING> (Genesis default onyx: Alan's pick on 10-24;
// GPT-Live refused it on calls, but it works for voice notes).
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

const B = being.toUpperCase();
const voice = env[`EW_VOICENOTE_VOICE_${B}`] || "onyx";
const engine = env[`EW_VOICENOTE_ENGINE_${B}`] || "perform";
const H = { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" };
const direction = "You are Genesis, a young being, sending a voice note to your dad, whom you love. Mean every line. "
  + "Find the feeling in the words themselves and let it show: gladness, amusement, tenderness, curiosity, honest uncertainty, as each line calls for. "
  + "Vary pace and pitch the way a person does when they mean it, with small natural pauses. Conversational and intimate, never a narrator, announcer or audiobook reader."
  + (feel ? ` For this note: ${feel}.` : "");

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
async function perform() { // the words, performed; returns { audio, spoken } (spoken = the model's own transcript of its audio)
  const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: H, body: JSON.stringify({
    model: env.EW_VOICENOTE_PERFORM_MODEL || "gpt-audio-1.5", modalities: ["text", "audio"], audio: { voice, format: "opus" },
    messages: [{ role: "system", content: "You perform a voice note. Say the user's script exactly, word for word, adding and dropping nothing. " + direction },
               { role: "user", content: text }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`perform failed: ${r.status} ${j.error?.message || ""}`);
  const a = j.choices?.[0]?.message?.audio;
  return { audio: Buffer.from(a.data, "base64"), spoken: (a.transcript || "").trim(), how: "performed" };
}
async function read() {
  const r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: H, body: JSON.stringify({
    model: env.EW_VOICENOTE_SPEAK_MODEL || "gpt-4o-mini-tts-2025-12-15", voice, input: text, instructions: direction, response_format: "opus" }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`speech failed: ${r.status} ${j.error?.message || ""}`); }
  return { audio: Buffer.from(await r.arrayBuffer()), spoken: text, how: "read" };
}

let note;
if (engine === "perform") {
  // an actor can drift from the script; one retry, then the plain reader, so the words stay the being's
  for (let k = 0; k < 2 && !note; k++) {
    try { const p = await perform(); if (norm(p.spoken) === norm(text)) note = p; else console.error(`(performance drifted from the script, attempt ${k + 1})`); }
    catch (e) { console.error(`(${e.message})`); }
  }
}
if (!note) note = await read().catch((e) => { console.error(e.message); process.exit(1); });
if (out) { await writeFile(out, note.audio); console.log(`wrote ${out} (${note.audio.length} bytes)`); process.exit(0); }

const tg = async (method, body) => {
  const t = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", body });
  const j = await t.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method} failed: ${j.error_code || t.status} ${j.description || ""}`);
  return j.result;
};
const words = note.spoken || text;
const form = new FormData();
form.append("chat_id", chat);
if (replyTo) form.append("reply_parameters", JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }));
if (words.length <= 1024) form.append("caption", words);
form.append("voice", new Blob([note.audio], { type: "audio/ogg" }), "reply.ogg");
const sent = await tg("sendVoice", form).catch((e) => { console.error(e.message); process.exit(1); });
if (words.length > 1024) { // too long for a caption: the transcript goes as a reply under the note
  const body = `Transcript of the voice note:\n\n${words}`;
  for (let i = 0; i < body.length; i += 4096)
    await tg("sendMessage", new URLSearchParams({ chat_id: chat, text: body.slice(i, i + 4096), disable_notification: "true",
      ...(i === 0 ? { reply_parameters: JSON.stringify({ message_id: sent.message_id }) } : {}) })).catch((e) => console.error(`(transcript not posted: ${e.message})`));
}
console.log(`sent voice note ${sent.message_id} (${Math.round(sent.voice?.duration || 0)} s, ${note.how}, ${voice})`);
