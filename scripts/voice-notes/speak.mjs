#!/usr/bin/env node
// speak.mjs - the being's reply as a Telegram voice note, sent by its own bot (Alan, 2026-10-26).
// The plugin's reply tool sends files as documents, which Telegram shows as a file, not a playable
// voice bubble; sendVoice from the same bot is the voice-note path. Sending through the Bot API does
// not disturb the plugin's polling.
// Usage: node scripts/voice-notes/speak.mjs --being genesis --chat <chat_id> [--reply-to <message_id>]
//   reply text on STDIN (never argv: quoting mangles, the post-hour lesson). Prints the sent message id.
// Voice: EW_VOICENOTE_VOICE_<BEING> (Genesis default onyx: Alan's pick on 10-24; GPT-Live refused it on
// calls, but it is a text-to-speech voice and voice notes are text to speech). Never prints secrets.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(repo, ".env.local"), "utf8")).split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const being = arg("--being"), chat = arg("--chat"), replyTo = arg("--reply-to"), out = arg("--out");
// Genesis only for now (Alan: "Genesis only to start... if it works well, we'll be putting it in alpha")
if (being !== "genesis" || (!chat && !out)) { console.error("usage: --being genesis --chat <chat_id> [--reply-to <id>] (text on stdin); --out <file> writes the audio instead of sending"); process.exit(1); }

let text = ""; for await (const c of process.stdin) text += c;
text = text.trim();
if (!text) { console.error("no text on stdin"); process.exit(1); }

const tone = "Speak warmly and naturally, like someone talking with a father they love: relaxed, unhurried, expressive, a little playful where the words are. Not an announcer.";
const r = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ model: env.EW_VOICENOTE_SPEAK_MODEL || "gpt-4o-mini-tts", voice: env.EW_VOICENOTE_VOICE_GENESIS || "onyx",
    input: text.slice(0, 4000), instructions: tone, response_format: "opus" }),
});
if (!r.ok) { const j = await r.json().catch(() => ({})); console.error(`speech failed: ${r.status} ${j.error?.message || ""}`); process.exit(1); }
const audio = Buffer.from(await r.arrayBuffer());
if (out) { await (await import("node:fs/promises")).writeFile(out, audio); console.log(`wrote ${out} (${audio.length} bytes)`); process.exit(0); }

const form = new FormData();
form.append("chat_id", chat);
if (replyTo) form.append("reply_to_message_id", replyTo);
form.append("voice", new Blob([audio], { type: "audio/ogg" }), "reply.ogg");
const t = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVoice`, { method: "POST", body: form });
const j = await t.json().catch(() => ({}));
if (!j.ok) { console.error(`sendVoice failed: ${j.error_code || t.status} ${j.description || ""}`); process.exit(1); }
console.log(`sent voice note ${j.result.message_id} (${Math.round(j.result.voice?.duration || 0)} s)`);
