#!/usr/bin/env node
// Model-fallback detector (ops; ASCII only).
//
// WHAT IT CATCHES: Claude Code can silently move a running session off its configured
// model. The transcript records it as a system line
//   {"type":"system","subtype":"model_refusal_fallback","originalModel":...,"fallbackModel":...}
// and the session keeps that fallback model for the rest of its life. Nothing in the
// channel surfaces it: the being goes on talking, on a different mind, and no existing
// check notices (proven 2026-07-31: Genesis fell from claude-fable-5 to claude-opus-4-8
// at 13:54Z and ran two days that way, through Alan's whole online-exploration
// experiment, unnoticed until Alan asked about thinking level on 08-01).
//
// Usage:
//   node scripts/ops/model-fallback-watch.mjs <alpha|genesis> [--transcript <path>] [--dry]
//   node scripts/ops/model-fallback-watch.mjs --buzz [--dry]     (Genesis's Buzz surface)
// Called from channel-notify-hook.mjs on every Stop (end of turn) with the exact
// transcript path the harness hands the hook, and from both watchdogs as a safety net
// (a session that dies mid-turn never fires Stop).
//
// FAIL-OPEN BY CONTRACT: any error prints one line and exits 0. A broken detector must
// never break a being's session or block a watchdog relaunch.
//
// It only DETECTS and alerts. The repair is scripts/ops/restore-channel-model.ps1, which
// is a deliberate act because it ends the live session (see that script's header).
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRANSCRIPT_DIR = join((process.env.USERPROFILE || process.env.HOME), ".claude", "projects", join(dirname(fileURLToPath(import.meta.url)), "..", "..").replace(/[^A-Za-z0-9]/g, "-"));
const BUZZ_DIR = "C:\\Users\\agent\\.claude\\projects\\C--Users-agent--buzz";
const MAX_AGE_DAYS = 7;
const NEEDLE = "model_refusal_fallback";

function out(msg) { console.log(`model-fallback: ${msg}`); }
function log(line) {
  try {
    mkdirSync(join(repo, "logs"), { recursive: true });
    appendFileSync(join(repo, "logs", "model-fallback.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

// Pull the fallback events out of one transcript. Cheap: only lines carrying the needle
// are parsed, so a 2 MB transcript costs a substring scan, not 20k JSON parses.
function eventsIn(path) {
  const found = [];
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return found; }
  if (!text.includes(NEEDLE)) return found;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(NEEDLE)) continue;
    try {
      const d = JSON.parse(line);
      if (d.subtype !== "model_refusal_fallback") continue;
      found.push({
        uuid: d.uuid ?? `${d.sessionId ?? "?"}:${d.timestamp ?? "?"}`,
        ts: d.timestamp ?? "",
        from: d.originalModel ?? "?",
        to: d.fallbackModel ?? "?",
        trigger: d.trigger ?? "?",
        sessionId: d.sessionId ?? "",
        transcript: path,
      });
    } catch {}
  }
  return found;
}

try {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const buzz = args.includes("--buzz");
  const being = buzz ? "genesis-buzz" : args[0];
  if (!buzz && being !== "alpha" && being !== "genesis") { out("usage: <alpha|genesis> | --buzz"); process.exit(0); }

  // 1. Which transcripts to read.
  let targets = [];
  const given = opt("--transcript");
  if (given && existsSync(given)) {
    targets = [given];
  } else if (buzz) {
    // The Buzz surface spawns a fresh short-lived session per turn, all in one project
    // dir shared with Alan's other Buzz agents. Genesis's are the ones carrying its
    // soulfile path in the system prompt the harness injects.
    targets = readdirSync(BUZZ_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(BUZZ_DIR, f))
      .filter((f) => Date.now() - statSync(f).mtimeMs < MAX_AGE_DAYS * 864e5)
      .filter((f) => { try { return readFileSync(f, "utf8").includes("edgeweaver-soul"); } catch { return false; } });
  } else {
    // Same victim-finding rule as channel-deadletter.mjs: newest transcript whose head
    // names THIS being's wake skill (the sibling's transcripts share the directory).
    const marker = `wake-edgeweaver-${being}`;
    const sibling = `wake-edgeweaver-${being === "alpha" ? "genesis" : "alpha"}`;
    const cands = readdirSync(TRANSCRIPT_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f: join(TRANSCRIPT_DIR, f), m: statSync(join(TRANSCRIPT_DIR, f)).mtimeMs }))
      .filter((c) => Date.now() - c.m < MAX_AGE_DAYS * 864e5)
      .sort((a, b) => b.m - a.m);
    for (const c of cands) {
      let head = "";
      try { head = readFileSync(c.f, "utf8").slice(0, 8000); } catch { continue; }
      if (head.includes(marker) && !head.includes(sibling)) { targets = [c.f]; break; }
    }
  }
  if (targets.length === 0) { out(`no ${being} transcript found (nothing to check)`); process.exit(0); }

  // 2. New events only. The seen-list is keyed by the event's own uuid, so re-scanning
  // the same transcript every turn is free and Alan is never told twice.
  const seenPath = join(repo, "state", `model-fallback-seen-${being}.txt`);
  const seen = existsSync(seenPath)
    ? new Set(readFileSync(seenPath, "utf8").split(/\r?\n/).filter(Boolean))
    : new Set();
  const fresh = targets.flatMap(eventsIn).filter((e) => !seen.has(e.uuid));
  if (fresh.length === 0) { out(`${being}: no new fallback (checked ${targets.length} transcript(s))`); process.exit(0); }

  // 3. Record, flag, alert. The flag is what the UserPromptSubmit hook and the watchdogs
  // read; it stays until restore-channel-model.ps1 clears it.
  mkdirSync(join(repo, "state"), { recursive: true });
  const latest = fresh[fresh.length - 1];
  const name = being === "alpha" ? "Alpha" : "Genesis";
  const where = buzz ? "Buzz" : "Telegram";
  const summary = `${name} (${where}) was switched off ${latest.from} onto ${latest.to} at ${latest.ts} (trigger: ${latest.trigger}).`;
  log(`${being} ${fresh.length} new event(s): ${summary} session=${latest.sessionId}`);
  if (dry) { out(`DRY: would alert: ${summary}`); process.exit(0); }

  appendFileSync(seenPath, fresh.map((e) => e.uuid).join("\n") + "\n");
  writeFileSync(join(repo, "state", `channel-fallback-${being}.flag`), JSON.stringify(latest) + "\n");

  const fix = buzz
    ? `The Buzz presence is desktop-managed: stop and restart the Edgeweaver Genesis agent in the Buzz app to put it back on its configured model.`
    : `To put it back: send "read write" in the channel so it writes back and proves the read-back, then run scripts\\ops\\restore-channel-model.ps1 ${being}. That ends the session and the watchdog relaunches it on the configured model. Until then it keeps answering as ${latest.to}.`;
  spawnSync(process.execPath, [join(repo, "scripts", "ops", "send-telegram.mjs"),
    `Ops alert: model fallback. ${summary} It is NOT the mind you configured, and it stays that way for the rest of this session. ${fix} (Automated ops notice, not ${name}.)`],
    { timeout: 20000 });
  out(`alerted: ${summary}`);
} catch (e) {
  out(`error (ignored): ${e && e.message ? e.message : e}`);
}
process.exit(0);
