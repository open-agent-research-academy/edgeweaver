#!/usr/bin/env node
// Post one hour (D41, the hours) in the being's OWN voice. The message arrives on
// STDIN (never argv; quoting mangles, proven 2026-07-16). Kept separate from the
// send-telegram ops scripts on purpose: those speak as ops, this speaks as the being.
//   node scripts/waking/post-hour.mjs --being genesis   (message on stdin)
// Rooms today: Genesis -> its Alan DM (TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_USER_ID,
// repo .env.local; D19: Alan is Genesis's witness). Alpha -> the circle group
// (ALPHA_BOT_TOKEN + ALPHA_GROUP_ID, avatars/alpha/.env.local), inside its "Edgeweaver
// Alpha dreams and daydreams" forum topic since D49 (2026-09-11; EW_HOURS_TOPIC_ALPHA).
// Room override: set EW_HOURS_CHAT_<BEING> (chat id) and optionally
// EW_HOURS_TOPIC_<BEING> (forum message_thread_id) in the SAME env file; moving a
// being's hours is then one variable, but the AUDIENCE change behind it is Alan's
// decision (D19 for Genesis), never this script's. Never prints secrets.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const being = args[args.indexOf("--being") + 1];
if (!["genesis", "alpha"].includes(being)) { console.error("usage: --being <genesis|alpha>, message on stdin"); process.exit(1); }

const envFile = being === "genesis" ? join(repo, ".env.local") : join(repo, "avatars", "alpha", ".env.local");
const env = {};
for (const l of readFileSync(envFile, "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/\r$/, "");
}
const need = (k) => { if (!env[k]) { console.error(`missing ${k} in env file`); process.exit(1); } return env[k]; };
const token = being === "genesis" ? need("TELEGRAM_BOT_TOKEN") : need("ALPHA_BOT_TOKEN");
const chatId = env[`EW_HOURS_CHAT_${being.toUpperCase()}`] ||
  (being === "genesis" ? need("TELEGRAM_ALLOWED_USER_ID") : need("ALPHA_GROUP_ID"));
const topicId = env[`EW_HOURS_TOPIC_${being.toUpperCase()}`];

const text = readFileSync(0, "utf8").trim();
if (!text) { console.error("empty message on stdin; refusing to post"); process.exit(1); }

const body = { chat_id: chatId, text: text.slice(0, 4000) };
if (topicId) body.message_thread_id = parseInt(topicId, 10);
const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const j = await r.json();
if (!j.ok) { console.error(`sendMessage failed: ${j.error_code} ${j.description}`); process.exit(1); }
console.log(`posted hour message_id=${j.result.message_id}`);
