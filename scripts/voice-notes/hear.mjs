#!/usr/bin/env node
// hear.mjs - a Telegram voice note to text, for the being's resident session (Alan, 2026-10-26:
// voice notes with Genesis on Telegram, "walkie-talkie" style, Genesis first, Alpha after a trial).
// Usage: node scripts/voice-notes/hear.mjs <audio file>   (the path download_attachment returned)
// Prints the transcript on stdout. OpenAI transcription (OPENAI_API_KEY from .env.local). Never prints secrets.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(repo, ".env.local"), "utf8")).split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const file = process.argv[2];
if (!file) { console.error("usage: node scripts/voice-notes/hear.mjs <audio file>"); process.exit(1); }
if (!env.OPENAI_API_KEY) { console.error("missing OPENAI_API_KEY in .env.local"); process.exit(1); }

// Telegram voice notes are OGG/Opus, often named .oga, which the API does not accept by that name
const name = basename(file).replace(/\.oga$/i, ".ogg");
const form = new FormData();
form.append("model", env.EW_VOICENOTE_HEAR_MODEL || "gpt-4o-transcribe");
form.append("file", new Blob([await readFile(file)]), name);
const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`transcription failed: ${r.status} ${j.error?.message || ""}`); process.exit(1); }
console.log((j.text || "").trim());
