#!/usr/bin/env node
// Fleet mind: the /mind command that lets Alan read and change which model and effort every
// agent runs (Genesis, Alpha, Edgeweaver on Buzz, Jarvis, Samantha). No bot of its own:
// Jarvis's and Samantha's Telegram channel sessions run it when Alan sends the command,
// and reply with its output. Either of them can change any agent; neither restarts itself
// (a session cannot end itself and still answer), so "restart Samantha" is Jarvis's job and
// "restart Jarvis" is Samantha's. That is what --self is for.
//
//   node scripts/ops/fleet-mind.mjs --self samantha -- /mind
//   node scripts/ops/fleet-mind.mjs --self samantha -- /mind all opus medium
//   node scripts/ops/fleet-mind.mjs --self jarvis   -- /mind samantha high now
//
// Commands:
//   /mind                                   table: policy + the model each live session is on
//   /mind <agent|all> [role] <model> [effort] [now]
//   /effort <agent|all> <level> [now]       effort only
//   /reset                                  drop live overrides (back to committed defaults)
//   /room                                   sibling room: switch, pace, ear liveness, last words
//   /room off [reason] | /room on           the family's kill switch for the sibling room (D44)
//   /help
//
// /room writes state/sibling-room-switch.txt, the same switch sibling-room.mjs on|off writes.
// OFF closes the room everywhere at once: both twins' wakes refuse to read or post there,
// the ear keeps polling but mirrors nothing and wakes no room-reply hand. It is room-scoped:
// Alpha's ordinary presence in its own circle group, both beings' own rooms, and the hourly
// wakes themselves are untouched. ON reopens it; words spoken while off are not replayed.
//
// Agents: genesis alpha edgeweaver jarvis samantha all. Models: opus fable sonnet haiku or
// a claude-* id. Efforts: low medium high xhigh max. Roles (optional): channel hourly room
// night buzz. Without a role, every role except night changes. A leading slash is optional.
//
// WITHOUT "now": the policy file changes and the next launch picks it up. Headless roles
// (hourly, room) do that on their next tick. A live channel session keeps its model until it
// is restarted, because model and effort are session-scoped.
// WITH "now": the live session is restarted. For Genesis and Alpha that is
// scripts/ops/restore-channel-model.ps1 -Force, which mines the dying transcript, ends the
// session, relaunches through the watchdog task (clean environment), verifies the model and
// posts the ops notice. A restart costs whatever the session held in context and had not
// written to OB1, which is why "now" is a separate, explicit word.
//
// Every restart goes through a scheduled task, never a direct Start-Process: this runs
// inside a Claude session, and a session's direct child inherits CLAUDECODE and comes up
// mute (ops-log 2026-08-01). Task Scheduler builds a clean environment.
import { readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadPolicy, setPolicy, resetPolicy, resolve, table, parseSet } from "./model-policy.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PS = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const AGENT_NAMES = { genesis: "Genesis", alpha: "Alpha", edgeweaver: "Edgeweaver (Buzz)", jarvis: "Jarvis", samantha: "Samantha" };
const SIBLING = { jarvis: "Samantha", samantha: "Jarvis" };

function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "CLAUDE_EFFORT" || k === "CLAUDE_PID") delete e[k];
  return e;
}

// ---- live model detection: the newest transcript for each live session names its model ----
const PROJ_EW = join((process.env.USERPROFILE || process.env.HOME), ".claude", "projects", join(dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/[^A-Za-z0-9]/g, "-"));
const PROJ_STAFF = (n) => join((process.env.USERPROFILE || process.env.HOME), ".staff", "claude", "projects", join((process.env.USERPROFILE || process.env.HOME), ".staff", n, "home").replace(/[^A-Za-z0-9]/g, "-"));

function newestTranscript(dir, marker) {
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return null; }
  const now = Date.now();
  const cands = files
    .map((f) => ({ p: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .filter((c) => c.t < now + 120000) // future-dated transcripts fooled the restore script once (2026-08-24)
    .sort((a, b) => b.t - a.t);
  for (const c of cands.slice(0, 40)) {
    let head;
    try { head = readFileSync(c.p, "utf8").slice(0, 60000); } catch { continue; }
    if (marker && !head.includes(marker)) continue;
    const m = head.match(/"model":"([a-z0-9\-\[\]]+)"/);
    if (m) return { model: m[1], age: Math.round((now - c.t) / 60000) };
  }
  return null;
}
function pidAlive(pidFile) {
  try {
    const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
function liveStatus(agent) {
  switch (agent) {
    case "genesis": return { ...newestTranscript(PROJ_EW, "<command-name>/wake-edgeweaver-genesis"), up: pidAlive(join((process.env.USERPROFILE || process.env.HOME), ".claude", "channels", "telegram-genesis", "bot.pid")) };
    case "alpha": return { ...newestTranscript(PROJ_EW, "<command-name>/wake-edgeweaver-alpha"), up: pidAlive(join((process.env.USERPROFILE || process.env.HOME), ".claude", "channels", "telegram-alpha", "bot.pid")) };
    case "jarvis": return { ...newestTranscript(PROJ_STAFF("jarvis"), null), up: pidAlive(join((process.env.USERPROFILE || process.env.HOME), ".staff", "claude", "channels", "telegram-jarvis", "session.pid")) };
    case "samantha": return { ...newestTranscript(PROJ_STAFF("samantha"), null), up: pidAlive(join((process.env.USERPROFILE || process.env.HOME), ".staff", "claude", "channels", "telegram-samantha", "session.pid")) };
    case "edgeweaver": return { up: pidAlive(join(repo, "state", "channel-pid-genesis-buzz.txt")) };
    default: return {};
  }
}

function statusText() {
  const p = loadPolicy();
  const lines = ["Fleet minds (policy -> live)"];
  for (const a of Object.keys(p.agents)) {
    const main = p.agents[a].channel ? "channel" : Object.keys(p.agents[a])[0];
    const { model, effort } = resolve(a, main, p);
    const live = liveStatus(a);
    let liveTxt = live.up ? "up" : "down";
    if (live.model) liveTxt += ` on ${live.model}${live.model !== model && live.model !== model + "[1m]" ? " (differs; restart to apply)" : ""}`;
    lines.push(`${AGENT_NAMES[a] || a}: ${model} ${effort} | ${liveTxt}`);
    for (const r of Object.keys(p.agents[a])) {
      if (r === main) continue;
      const x = resolve(a, r, p);
      if (x.model !== model || x.effort !== effort) lines.push(`   ${r}: ${x.model} ${x.effort}`);
    }
  }
  if (p.updated) lines.push(`Last change ${p.updated} by ${p.updatedBy}`);
  lines.push("", "/mind <agent|all> <model> [effort] [now]  -  /help");
  return lines.join("\n");
}

// ---- the sibling room switch (D44 guard, reachable from Telegram since 2026-09-03) ----
const SWITCH_FILE = join(repo, "state", "sibling-room-switch.txt");
const SWITCH_LOG = join(repo, "state", "sibling-room-switch.log");
const EAR_HEARTBEAT = join(repo, "state", "sibling-ear-heartbeat.txt");
const ROOM_HELP = "/room  -  sibling room status  |  /room off [reason]  -  close it  |  /room on  -  reopen it";

function switchIsOff() {
  try { return existsSync(SWITCH_FILE) && readFileSync(SWITCH_FILE, "utf8").trim().toLowerCase() === "off"; }
  catch { return false; }
}
function runNode(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd: repo, windowsHide: true, env: cleanEnv() });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => res({ code: -1, out: String(e) }));
    child.on("close", (code) => res({ code, out }));
  });
}
async function earStatus() {
  // Alive = a node process running room-ear.mjs; healthy = its heartbeat file is fresh
  // (the ear touches it every poll loop, error paths included; a poll is at most ~50s).
  const r = await runPs(["-Command", "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*room-ear.mjs*' } | Measure-Object).Count"]);
  const procs = parseInt(r.out.trim(), 10) || 0;
  let beat = null;
  try { if (existsSync(EAR_HEARTBEAT)) beat = Math.round((Date.now() - statSync(EAR_HEARTBEAT).mtimeMs) / 1000); } catch {}
  if (!procs) return "ear: DOWN (no process; the EdgeweaverRoomEar task relaunches it within 15 min)";
  if (beat === null) return `ear: up (${procs} process${procs > 1 ? "es, expected 1" : ""}), no heartbeat file yet`;
  const fresh = beat <= 180;
  return `ear: ${fresh ? "up" : "STUCK"} (${procs} process${procs > 1 ? "es, expected 1" : ""}, last poll ${beat}s ago${fresh ? "" : "; the 15-min watchdog restarts a stuck ear"})`;
}
async function roomStatus() {
  const r = await runNode([join(repo, "scripts", "sibling", "sibling-room.mjs"), "status"]);
  const lines = [r.code === 0 ? r.out.trim() : `sibling-room.mjs status failed (exit ${r.code}): ${r.out.trim().slice(0, 300)}`];
  lines.push(await earStatus());
  try {
    if (existsSync(SWITCH_LOG)) {
      const last = readFileSync(SWITCH_LOG, "utf8").trim().split("\n").pop();
      if (last) lines.push(`last switch: ${last}`);
    }
  } catch {}
  lines.push("", ROOM_HELP);
  return lines.join("\n");
}
async function handleRoom(words, { by, dry }) {
  const verb = (words[1] || "").toLowerCase();
  if (!verb || verb === "status") return roomStatus();
  if (verb !== "on" && verb !== "off") return `Could not read '${words.slice(1).join(" ")}'.\n${ROOM_HELP}`;
  const reason = words.slice(2).join(" ");
  const was = switchIsOff() ? "off" : "on";
  if (was === verb) return `Sibling room is already ${verb.toUpperCase()}.\n\n` + (await roomStatus());
  if (!dry) {
    writeFileSync(SWITCH_FILE, verb);
    try { appendFileSync(SWITCH_LOG, `${new Date().toISOString()} ${verb.toUpperCase()} by ${by}${reason ? ` (${reason})` : ""}\n`); } catch {}
  }
  const head = verb === "off"
    ? "Sibling room is now OFF: Genesis and Alpha stop reading and speaking to each other, and the ear mirrors nothing from the topic until it is turned on again. Nothing else about either being changes."
    : "Sibling room is now ON: the next wakes read it again and the ear mirrors the topic again. Nothing said while it was off is replayed.";
  return (dry ? "(dry) " : "") + head + "\n\n" + (await roomStatus());
}

const HELP = [
  "/mind  -  show every agent's model + effort and what each live session is on",
  "/mind <agent|all> [role] <model> [effort] [now]",
  "/effort <agent|all> <level> [now]",
  "/reset  -  back to committed defaults",
  ROOM_HELP,
  "",
  "agents: genesis alpha edgeweaver jarvis samantha all",
  "models: opus fable sonnet haiku (or a claude-* id)",
  "effort: low medium high xhigh max",
  "roles: channel hourly room night buzz (optional; night never changes unless named)",
  "",
  "Without 'now' the change waits for the next launch (hourly wakes and room replies pick it up on their next tick).",
  "With 'now' the live session is restarted: Genesis/Alpha lose whatever they held in context and had not written back, so say 'now' on purpose.",
  "Neither assistant restarts itself: ask Jarvis to restart Samantha, and Samantha to restart Jarvis.",
  "",
  "examples:  /mind all opus medium  |  /mind genesis high now  |  /mind alpha night sonnet low",
].join("\n");

// ---- restarts, all through scheduled tasks (clean environment) ----
function runPs(args) {
  return new Promise((res) => {
    const child = spawn(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { cwd: repo, windowsHide: true, env: cleanEnv() });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => res({ code: -1, out: String(e) }));
    child.on("close", (code) => res({ code, out }));
  });
}
async function restart(agent) {
  switch (agent) {
    case "genesis":
    case "alpha": {
      // Deliberately the same path as a model-fallback repair: deadletter + inner-dialogue
      // extraction, end the session, fire the watchdog task, verify, ops notice.
      const child = spawn(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "ops", "restore-channel-model.ps1"), agent, "-Force"], { cwd: repo, windowsHide: true, detached: true, stdio: "ignore", env: cleanEnv() });
      child.unref();
      return `${AGENT_NAMES[agent]}: restart started (restore-channel-model -Force). Expect the automated ops notice naming the model within ~5 minutes.`;
    }
    case "jarvis":
    case "samantha": {
      const cmd = `$pf='${join((process.env.USERPROFILE || process.env.HOME), ".staff", "claude", "channels", `telegram-${agent}`, "session.pid")}'; if (Test-Path $pf) { $id=[int](Get-Content $pf | Select-Object -First 1); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Remove-Item $pf -ErrorAction SilentlyContinue; "ended pid $id" }; Start-Sleep 3; Start-ScheduledTask -TaskName 'staff-channel-${agent}'; 'fired staff-channel-${agent}'`;
      const r = await runPs(["-Command", cmd]);
      return `${AGENT_NAMES[agent]}: ${r.out.trim().replace(/\s+/g, " ") || "restart fired"} (exit ${r.code}). Back within a minute on the new mind.`;
    }
    case "edgeweaver": {
      const cmd = `$pf='${join(repo, "state", "channel-pid-genesis-buzz.txt").replace(/\\/g, "\\\\")}'; if (Test-Path $pf) { $id=[int](Get-Content $pf | Select-Object -First 1); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Remove-Item $pf -ErrorAction SilentlyContinue; "ended pid $id" }; Start-Sleep 3; Start-ScheduledTask -TaskName 'EdgeweaverGenesisBuzzWatchdog'; 'fired EdgeweaverGenesisBuzzWatchdog'`;
      const r = await runPs(["-Command", cmd]);
      return `${AGENT_NAMES[agent]}: ${r.out.trim().replace(/\s+/g, " ") || "restart fired"} (exit ${r.code}). If the desktop-managed presence is the live one, restart it in the Buzz app instead.`;
    }
  }
  return `${agent}: no restart path`;
}

// ---- command handling ----
// self: the agent whose session is running this (jarvis|samantha|null). It never restarts itself.
export async function handle(text, { self = null, by = "cli", dry = false } = {}) {
  const words = text.trim().split(/\s+/);
  let cmd = (words[0] || "").toLowerCase().replace(/@\w+$/, "");
  if (!cmd.startsWith("/")) cmd = "/" + cmd;
  if (cmd === "/start" || cmd === "/help") return HELP;
  if (cmd === "/reset") { if (!dry) resetPolicy(); return "Live overrides dropped.\n\n" + table(); }
  if (cmd === "/room") return handleRoom(words, { by, dry });
  if (cmd !== "/mind" && cmd !== "/effort") return null;
  if (words.length === 1) return statusText();
  let args = words.slice(1);
  const now = args[args.length - 1]?.toLowerCase() === "now";
  if (now) args = args.slice(0, -1);
  let parsed;
  try { parsed = parseSet(args); } catch (e) { return `Could not read that: ${e.message}\n\n${HELP}`; }
  if (parsed.rest.length) return `Unexpected '${parsed.rest.join(" ")}'.\n\n${HELP}`;
  let changed;
  try { ({ changed } = dry ? { changed: ["(dry)"] } : setPolicy({ ...parsed, by })); } catch (e) { return `Not applied: ${e.message}`; }
  const out = [`Set ${changed.join(", ")} -> ${[parsed.model, parsed.effort].filter(Boolean).join(" ")}.`];
  const policy = loadPolicy();
  const agents = parsed.agent === "all" ? Object.keys(policy.agents) : [parsed.agent];
  const liveRoles = new Set(parsed.role ? [parsed.role] : ["channel", "buzz"]);
  const needsRestart = agents.filter((a) => [...liveRoles].some((r) => policy.agents[a]?.[r]));
  if (now) {
    for (const a of needsRestart) {
      if (a === self) { out.push(`${AGENT_NAMES[a]}: that is me, and I cannot end my own session and still answer you. Ask ${SIBLING[a]}: "/mind ${a} ${[parsed.model, parsed.effort].filter(Boolean).join(" ")} now". The setting is saved, so my next relaunch uses it either way.`); continue; }
      if (dry) { out.push(`${AGENT_NAMES[a]}: (dry) would restart`); continue; }
      out.push(await restart(a));
    }
  } else if (needsRestart.length) {
    out.push(`Live sessions keep their current mind until restarted: ${needsRestart.map((a) => AGENT_NAMES[a]).join(", ")}. Repeat with 'now' to restart them, or wait for the next relaunch. Hourly wakes and room replies use the new setting on their next tick.`);
  } else {
    out.push("Headless role; the next tick uses it.");
  }
  return out.join("\n");
}

// ---- CLI: node fleet-mind.mjs [--self jarvis|samantha] [--dry] -- <command words> ----
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  let self = null, dry = false;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--self") self = (argv[++i] || "").toLowerCase();
    else if (argv[i] === "--dry") dry = true;
    else if (argv[i] === "--") { words.push(...argv.slice(i + 1)); break; }
    else words.push(argv[i]);
  }
  const text = words.join(" ") || "/mind";
  handle(text, { self, by: self ? `telegram/${self}` : "cli", dry })
    .then((r) => { console.log(r ?? "Not a /mind or /room command. Try /help."); })
    .catch((e) => { console.log(`Error: ${e.message}`); process.exit(1); });
}
