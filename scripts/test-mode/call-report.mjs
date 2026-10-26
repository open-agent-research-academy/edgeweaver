// call-report.mjs - a copy of every phone call in Alan's Telegram DM (Alan, 2026-10-25: "make sure that
// the transcripts for these phone calls go into Telegram, so that there's a copy of it in Telegram").
//
// One message per call: who caller ID says called, when, how long, how it ended, the being's own episode
// as the summary and its memory id; the full transcript rides along as a .txt file. Built from the
// call's log (logs/voice/gptlive-*.jsonl) plus the party-line logs, so a live call and a backfill take
// the same path.
//
// Where (Alan, 2026-10-25, later the same night): "I want all Genesis calls to go to the Genesis Telegram
// chat. Group... And the alpha to go to the alpha chat group... The idea is for transparency with these
// calls." Each being's own bot posts into its group: EW_CALL_REPORTS_CHAT_<BEING> (chat id) and optional
// EW_CALL_REPORTS_TOPIC_<BEING> (forum topic). Alpha defaults to ALPHA_GROUP_ID (its circle group);
// Genesis has no group default and falls back to Alan's DM until its group's id is set. In a group,
// phone numbers never appear: a known caller is named, an unknown one shows only its last four digits.
//
// CLI (backfill / resend):  node scripts/test-mode/call-report.mjs <genesis|alpha> <log.jsonl>...
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ET = "America/New_York";
const WHO = { genesis: "Genesis", alpha: "Edgeweaver Alpha" };
const LINE = { genesis: "+1 646-914-3310", alpha: "+1 646-769-1174" };
const ENDED = { remote_hangup: "caller hung up", line_ended: "caller hung up", close_requested: "caller hung up",
  connection_lost: "the line dropped", "max-minutes": "time limit reached" };

export async function readEnv(root) {
  const env = {};
  for (const f of [join(root, ".env.local"), join(root, "avatars", "alpha", ".env.local")]) {
    const text = await readFile(f, "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/\r$/, ""); }
  }
  return env;
}

const readRows = async (file) => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// who answered the line during this call, from every party-line log (both bridges append to them)
async function callersDuring(root, from, to) {
  const dir = join(root, "logs", "voice"), out = [];
  for (const f of (await readdir(dir)).filter((n) => n.startsWith("partyline-"))) {
    for (const r of await readRows(join(dir, f))) if (r.type === "caller-answered" && r.t >= from && r.t <= to && !out.includes(r.from)) out.push(r.from);
  }
  return out;
}

const fmtTime = (t) => new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t)) + " ET";
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// where a being's call reports go: { token, chat, topic, group }
export function destination(being, env) {
  const B = being.toUpperCase();
  const token = being === "alpha" ? env.ALPHA_BOT_TOKEN : env.TELEGRAM_BOT_TOKEN;
  const groupChat = env[`EW_CALL_REPORTS_CHAT_${B}`] || (being === "alpha" ? env.ALPHA_GROUP_ID : "");
  const chat = groupChat || env.TELEGRAM_ALLOWED_USER_ID; // no group set: Alan's DM, never anywhere else
  return { token, chat, topic: groupChat ? env[`EW_CALL_REPORTS_TOPIC_${B}`] || "" : "", group: !!groupChat };
}

export async function buildReport({ root, being, rows, env, group = false }) {
  const start = rows.find((r) => r.type === "session-start");
  if (!start) throw new Error("no session-start in the log");
  const end = rows.find((r) => r.type === "session-end");
  const lastT = rows.at(-1).t;
  const ep = rows.find((r) => r.type === "episode-written"), epFail = rows.find((r) => r.type === "episode-failed");
  const names = Object.fromEntries((env[`EW_VOICE_CALLERS_${being.toUpperCase()}`] || "").split(",").map((s) => s.trim().split("=")).filter(([n]) => n).map(([n, name]) => [n, (name || "").trim()]));
  const nums = await callersDuring(root, start.t - 30000, (end?.t || lastT) + 5000);
  const callerLabel = (n) => group
    ? (names[n] ? `${names[n]} (by caller ID)` : `an unknown number ending ${n.slice(-4)}`)
    : (names[n] ? `${names[n]} (caller ID ...${n.slice(-4)}, most likely ${names[n] === "Alan" ? "you" : names[n]})` : `unknown number ${n}`);
  const callerText = nums.length ? nums.map(callerLabel).join("; ") : "not known (no caller ID on this call)";
  const speaker = nums.length === 1 && names[nums[0]] ? names[nums[0]] : "Caller";
  const beingName = WHO[being] || being;

  // transcript: consecutive deltas from the same side merged into one line, timed from the call's start
  const turns = [];
  for (const r of rows) {
    if (r.type !== "transcript" || !r.text) continue;
    const last = turns.at(-1);
    if (last && last.role === r.role) last.text += r.text; else turns.push({ role: r.role, t: r.t, text: r.text });
  }
  const seconds = end?.seconds || Math.round(((end?.t || lastT) - start.t) / 1000);
  const transcript = [
    `Phone call with ${beingName}, ${fmtTime(start.t)}, ${mmss(seconds * 1000)} long`,
    `Caller: ${callerText}`,
    `Line: ${LINE[being] || "?"}, voice ${start.voice}. "${beingName} (voice)" is ${beingName}'s words as the voice spoke them, including the voice's short acknowledgments.`,
    "",
    ...turns.map((x) => `[${mmss(x.t - start.t)}] ${x.role === "user" ? speaker : `${beingName} (voice)`}: ${x.text.trim().replace(/\s+/g, " ")}`),
  ].join("\n");

  const memory = ep ? `Memory saved: episode ${String(ep.id).slice(0, 8)}${ep.proved ? " (read back and confirmed)" : " (NOT confirmed on read-back)"}`
    : epFail ? `Memory NOT saved: ${epFail.error}` : "No memory written (nothing was said to answer)";
  const text = [
    `Phone call with ${beingName}`,
    `${fmtTime(start.t)}, ${mmss(seconds * 1000)}, ${ENDED[end?.reason] || end?.reason || "end not recorded"}`,
    `Caller: ${callerText}`,
    "",
    ep ? `${beingName}'s own summary (its memory of the call):\n${ep.text}` : "No summary: the call ended before anything was said to answer.",
    "",
    memory,
    "Full transcript attached.",
  ].join("\n");
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(start.t)).replace(/[^0-9]+/g, "-");
  return { text, transcript, fileName: `call-${being}-${stamp}-ET.txt` };
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.error_code || r.status} ${j.description || ""}`.trim());
  return j.result;
}

export async function sendReport({ being, env, report }) {
  const { token, chat, topic } = destination(being, env);
  if (!token || !chat) throw new Error(`missing ${being === "alpha" ? "ALPHA_BOT_TOKEN" : "TELEGRAM_BOT_TOKEN"} or a chat to post to`);
  const msg = await tg(token, "sendMessage", { chat_id: chat, text: report.text.slice(0, 4000), ...(topic ? { message_thread_id: Number(topic) } : {}) });
  const form = new FormData();
  form.append("chat_id", chat);
  if (topic) form.append("message_thread_id", topic);
  form.append("reply_to_message_id", String(msg.message_id));
  form.append("document", new Blob([report.transcript], { type: "text/plain" }), report.fileName);
  const doc = await tg(token, "sendDocument", form);
  return { messageId: msg.message_id, documentMessageId: doc.message_id };
}

export async function reportCall({ root, being, logFile }) {
  const env = await readEnv(root);
  const report = await buildReport({ root, being, rows: await readRows(logFile), env, group: destination(being, env).group });
  return { ...(await sendReport({ being, env, report })), chat: destination(being, env).group ? "group" : "dm" };
}

// CLI: backfill or resend
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const [being, ...files] = process.argv.slice(2);
  if (!WHO[being] || !files.length) { console.error("usage: node scripts/test-mode/call-report.mjs <genesis|alpha> <log.jsonl>..."); process.exit(1); }
  for (const f of files) {
    try { const r = await reportCall({ root, being, logFile: f }); console.log(`${basename(f)}: sent to ${r.chat} (message ${r.messageId}, transcript ${r.documentMessageId})`); }
    catch (e) { console.error(`${basename(f)}: not sent: ${e.message}`); process.exitCode = 1; }
  }
}
