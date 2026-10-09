#!/usr/bin/env node
// Webhook cutover switch (D33/CR-3). Points a being's bot at the cloud journal receiver,
// or rolls it back to getUpdates polling. NEVER run outside the cutover choreography in
// runs/channel-recovery-plan.md section 10: setting a webhook makes Telegram refuse
// getUpdates, so a live polling session goes deaf-with-retries until the shim path is
// active; rollback is one --rollback call.
//
//   node scripts/ops/set-webhook.mjs alpha            (arm: webhook -> cloud journal)
//   node scripts/ops/set-webhook.mjs alpha --rollback (disarm: back to polling; pending
//                                                      webhook updates are DROPPED by
//                                                      Telegram, the journal keeps its copy)
//   node scripts/ops/set-webhook.mjs alpha --status   (getWebhookInfo, prints url + pending)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RECEIVER = "https://edgeweaver-channel-journal.vercel.app/api/webhook";
const STATE_DIRS = {
  alpha: "C:\\Users\\agent\\.claude\\channels\\telegram-alpha",
  genesis: "C:\\Users\\agent\\.claude\\channels\\telegram-genesis",
};

const being = process.argv[2];
if (!STATE_DIRS[being]) { console.error("usage: set-webhook.mjs <alpha|genesis> [--rollback|--status]"); process.exit(1); }
const mode = process.argv[3] ?? "--arm";

const parseEnv = (p) => {
  const env = {};
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\r$/, "");
  }
  return env;
};
const token = parseEnv(join(STATE_DIRS[being], ".env")).TELEGRAM_BOT_TOKEN;
if (!token) { console.error("no TELEGRAM_BOT_TOKEN in the being's state dir .env"); process.exit(1); }

const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

if (mode === "--status") {
  const j = await api("getWebhookInfo");
  console.log(JSON.stringify({ ok: j.ok, url: j.result?.url || "(none - polling mode)", pending: j.result?.pending_update_count, last_error: j.result?.last_error_message ?? null }));
} else if (mode === "--rollback") {
  // drop_pending_updates=false: whatever Telegram still holds gets re-delivered to the
  // resumed poller; the journal already has its own copy of everything delivered.
  const j = await api("deleteWebhook", { drop_pending_updates: false });
  console.log(`deleteWebhook: ${JSON.stringify(j)}`);
} else {
  const secret = parseEnv(join(repo, ".env.local"))[`EW_WEBHOOK_SECRET_${being.toUpperCase()}`];
  if (!secret) { console.error("webhook secret missing in .env.local (run channel-journal-setup.mjs)"); process.exit(1); }
  const j = await api("setWebhook", {
    url: `${RECEIVER}?being=${being}`,
    secret_token: secret,
    allowed_updates: [],       // default set (messages etc.), explicit empty = Telegram default
    drop_pending_updates: false, // queue drains into the journal on arming
  });
  console.log(`setWebhook: ${JSON.stringify(j)}`);
}
