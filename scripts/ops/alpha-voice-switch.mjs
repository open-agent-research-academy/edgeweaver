#!/usr/bin/env node
// alpha-voice-switch.mjs - the one switch for Alpha's call button and voice notes (Alan, 2026-10-26: "roll all of the
// backend of this out for alpha. Once I get the go-ahead from the Circle, we can flip the switch").
// Usage: node scripts/ops/alpha-voice-switch.mjs <on|off|status>
// Sets EW_CALL_BUTTON_ALPHA and EW_VOICENOTE_ALPHA in .env.local together. Both are read live: the call button
// follows within a minute (Alpha's bridge re-reads the switch; off answers 404 and clears each seat's menu button),
// voice notes on the next note. Alpha's Telegram session reads its voice-note instructions (wake skill 4b) at its
// next restart. Touches no other line; prints only the two switches.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = ["EW_CALL_BUTTON_ALPHA", "EW_VOICENOTE_ALPHA"];
const file = join(import.meta.dirname, "..", "..", ".env.local");
const want = process.argv[2];
if (!["on", "off", "status"].includes(want)) { console.error("usage: node scripts/ops/alpha-voice-switch.mjs <on|off|status>"); process.exit(1); }

let text = readFileSync(file, "utf8");
const nl = text.includes("\r\n") ? "\r\n" : "\n";
const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim() || "off (unset)";
if (want !== "status") {
  for (const k of KEYS) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${want}`) : `${text.replace(/\s*$/, "")}${nl}${k}=${want}${nl}`;
  }
  writeFileSync(file, text);
}
for (const k of KEYS) console.log(`${k}=${get(k)}`);
if (want === "on") console.log("Call button: live within a minute for seats who have opened Alpha's bot in a private chat.\nVoice notes: restart Alpha's Telegram session once so it reads them (scripts/ops/restore-channel-model.ps1 alpha -Force).");
