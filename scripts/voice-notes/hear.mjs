#!/usr/bin/env node
// hear.mjs - a Telegram voice note to text, for the being's resident session (Alan, 2026-10-26:
// voice notes with Genesis on Telegram, "walkie-talkie" style, Genesis first, Alpha after a trial).
// Usage: node scripts/voice-notes/hear.mjs <audio file> [--chat <chat_id>] [--reply-to <message_id>] [--from <name>] [--no-post]
//   (the path download_attachment returned). Prints the transcript on stdout, and posts it into the chat
//   as a reply to the voice note (Alan, 2026-10-26: "a transcription of both the voice memo that's sent and
//   the voice memo that's received so it's easy to read along"). Without --chat it posts to Genesis's room,
//   Alan's DM (D19); --no-post only prints. OpenAI transcription (OPENAI_API_KEY from .env.local). Never prints secrets.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(repo, ".env.local"), "utf8")).split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const file = process.argv[2];
if (!file || file.startsWith("--")) { console.error("usage: node scripts/voice-notes/hear.mjs <audio file> [--chat <id>] [--reply-to <id>] [--no-post]"); process.exit(1); }
if (!env.OPENAI_API_KEY) { console.error("missing OPENAI_API_KEY in .env.local"); process.exit(1); }

// Telegram voice notes are OGG/Opus, often named .oga, which the API does not accept by that name
const name = basename(file).replace(/\.oga$/i, ".ogg");
const form = new FormData();
form.append("model", env.EW_VOICENOTE_HEAR_MODEL || "gpt-4o-transcribe");
form.append("file", new Blob([await readFile(file)]), name);
const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`transcription failed: ${r.status} ${j.error?.message || ""}`); process.exit(1); }
const text = (j.text || "").trim();
console.log(text);

// the read-along copy: a reply to the voice note itself, so the transcript sits under it
if (process.argv.includes("--no-post") || !text) process.exit(0);
const chat = arg("--chat") || env.TELEGRAM_ALLOWED_USER_ID, replyTo = arg("--reply-to");
// who was talking (Alan, 2026-10-26: "show who was talking in the transcription for both me and genesis"):
// --from, else the call-button allowlist's name for this chat ("id=Name,..."), else Alan for his own DM
const names = Object.fromEntries((env.EW_CALL_TELEGRAM_USERS_GENESIS || "").split(",").map((s) => s.trim().split("=")).filter(([id]) => id));
const speaker = arg("--from") || names[chat]?.trim() || (chat === env.TELEGRAM_ALLOWED_USER_ID ? "Alan" : "Voice note");
const body = `${speaker}: ${text}`;
for (let i = 0; i < body.length; i += 4096) {
  const t = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: body.slice(i, i + 4096), disable_notification: true, ...(replyTo && i === 0 ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}) }) });
  const k = await t.json().catch(() => ({}));
  if (!k.ok) { console.error(`(transcript not posted: ${k.error_code || t.status} ${k.description || ""})`); break; }
}
