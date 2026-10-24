// telnyx-gptlive-setup.mjs - wire a Telnyx number to the GPT-Live bridge, by API.
//
// Two routes, Alan's 2026-10-23 choice is the PARTY LINE:
//   app        (default) a Call Control application whose webhooks hit the bridge's /webhooks/telnyx;
//              the bridge answers every caller into one conference and dials one SIP leg to OpenAI
//              (scripts/test-mode/party-line.mjs). Needs an outbound voice profile for that dial.
//   connection (legacy 1:1) an FQDN connection straight to sip.api.openai.com:5061 per Telnyx's
//              GPT-Live guide; one caller per GPT-Live session, no party line.
//
// Account creation, billing and the API key are Alan's hands (the key arrives via the masked window
// into .env.local as TELNYX_API_KEY). Buying a number spends money: `order` runs only after Alan says
// yes to a specific number and its price printed by `search`.
//
// Usage: node scripts/ops/telnyx-gptlive-setup.mjs <command>
//   status                   balance, apps, connections, numbers, public key presence (read-only)
//   app <webhook-url>        create or update the Call Control app (+ outbound voice profile) for that URL
//   connection               (legacy) create the FQDN connection + FQDN if missing
//   search [--area 415] [--type local|toll_free]   list buyable US voice numbers with prices (read-only)
//   order +1XXXXXXXXXX       BUY that number (money), then assign it to the app
//   assign +1XXXXXXXXXX      attach an owned number to the app (or --legacy: to the FQDN connection + translated number)
// Env (.env.local): TELNYX_API_KEY (required), OPENAI_PROJECT_ID (legacy assign; the bridge needs it too),
//   EW_TELNYX_APP_NAME (default "Edgeweaver GPT-Live line"), EW_TELNYX_CONNECTION_NAME (default "Edgeweaver GPT-Live").
// Prints the env lines the bridge needs (TELNYX_APP_ID, TELNYX_NUMBER); they are ids, not secrets.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(ROOT, ".env.local"), "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const KEY = env.TELNYX_API_KEY;
const PROJECT = env.OPENAI_PROJECT_ID || "";
const APP_NAME = env.EW_TELNYX_APP_NAME || "Edgeweaver GPT-Live line";
const CONN_NAME = env.EW_TELNYX_CONNECTION_NAME || "Edgeweaver GPT-Live";
const PROFILE_NAME = "Edgeweaver GPT-Live outbound";
const OPENAI_FQDN = "sip.api.openai.com", OPENAI_PORT = 5061;
if (!KEY) { console.error("TELNYX_API_KEY missing in .env.local (use the masked-secret-entry window)"); process.exit(2); }

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const e164 = args.find((a) => /^\+\d{8,15}$/.test(a));

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("https://api.telnyx.com/v2" + path, {
    method, headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) {
    const detail = j?.errors?.map((e) => `${e.code || ""} ${e.title || ""}: ${e.detail || ""}`.trim()).join("; ") || text.slice(0, 300);
    throw new Error(`Telnyx ${method} ${path} -> ${r.status}: ${detail}`);
  }
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- lookups ----
async function findApp() {
  const j = await api(`/call_control_applications?filter[application_name][contains]=${encodeURIComponent(APP_NAME)}&page[size]=50`);
  return (j.data || []).find((a) => a.application_name === APP_NAME) || null;
}
async function findProfile() {
  // account levels cap the profile count (one at Paid), so reuse any existing enabled profile rather than create a second
  const j = await api(`/outbound_voice_profiles?page[size]=50`);
  const all = j.data || [];
  return all.find((p) => p.name === PROFILE_NAME) || all.find((p) => p.enabled) || all[0] || null;
}
async function findConnection() {
  const j = await api(`/fqdn_connections?filter[connection_name][contains]=${encodeURIComponent(CONN_NAME)}&page[size]=50`);
  return (j.data || []).find((c) => c.connection_name === CONN_NAME) || null;
}
async function listFqdns(connectionId) { return (await api(`/fqdns?filter[connection_id]=${encodeURIComponent(connectionId)}&page[size]=50`)).data || []; }
async function ownedNumber(number) { return ((await api(`/phone_numbers?filter[phone_number]=${encodeURIComponent(number)}`)).data || [])[0] || null; }

// ---- commands ----
async function cmdStatus() {
  try { const b = await api("/balance"); console.log(`balance: ${b.data?.balance} ${b.data?.currency} (credit limit ${b.data?.credit_limit})`); }
  catch (e) { console.log("balance: " + e.message); }
  const app = await findApp();
  console.log(app ? `app "${APP_NAME}": id ${app.id}, webhook ${app.webhook_event_url}, active ${app.active}, outbound profile ${app.outbound?.outbound_voice_profile_id || "none"}` : `app "${APP_NAME}": MISSING (run: app <webhook-url>)`);
  const prof = await findProfile();
  console.log(prof ? `outbound voice profile: id ${prof.id}, enabled ${prof.enabled}` : "outbound voice profile: missing");
  const c = await findConnection();
  console.log(c ? `legacy connection "${CONN_NAME}": id ${c.id} (${c.transport_protocol}/${c.encrypted_media || "no srtp"})` : `legacy connection "${CONN_NAME}": none`);
  if (c) for (const f of await listFqdns(c.id)) console.log(`  fqdn ${f.fqdn}:${f.port} (${f.dns_record_type})`);
  const nums = (await api("/phone_numbers?page[size]=50")).data || [];
  for (const n of nums) console.log(`number ${n.phone_number}: status ${n.status}, connection ${n.connection_id || "none"}${app && n.connection_id === app.id ? " (the party-line app)" : ""}${c && n.connection_id === c.id ? " (legacy connection)" : ""}`);
  if (!nums.length) console.log("numbers: none owned");
  console.log(`openai project id: ${PROJECT || "NOT SET (OPENAI_PROJECT_ID)"}`);
  if (app) console.log(`\nbridge env: TELNYX_APP_ID=${app.id}${nums[0] ? `  TELNYX_NUMBER=${nums[0].phone_number}` : ""}`);
}

async function cmdApp() {
  const url = args.find((a) => /^https:\/\//.test(a));
  if (!url) throw new Error("app needs the webhook URL, e.g. https://<tunnel>/webhooks/telnyx");
  // the bridge verifies by Ed25519 when the account offers a public key, else by this secret path segment
  const token = env.TELNYX_WEBHOOK_TOKEN || "";
  const webhookUrl = token && !url.includes(token) ? url.replace(/\/$/, "") + "/" + token : url;
  let prof = await findProfile();
  if (!prof) {
    prof = (await api("/outbound_voice_profiles", { method: "POST", body: { name: PROFILE_NAME, traffic_type: "conversational", service_plan: "global", enabled: true, usage_payment_method: "rate-deck", concurrent_call_limit: 4, daily_spend_limit: "5.00", daily_spend_limit_enabled: true } })).data;
    console.log(`created outbound voice profile ${prof.id} (daily spend cap $5)`);
  } else console.log(`outbound voice profile exists: ${prof.id}`);
  let app = await findApp();
  const body = { application_name: APP_NAME, webhook_event_url: webhookUrl, webhook_api_version: "2", active: true, anchorsite_override: "Latency", dtmf_type: "RFC 2833", first_command_timeout: true, first_command_timeout_secs: 20, inbound: { channel_limit: 6 }, outbound: { channel_limit: 2, outbound_voice_profile_id: prof.id } };
  if (!app) { app = (await api("/call_control_applications", { method: "POST", body })).data; console.log(`created call control app ${app.id}`); }
  else { app = (await api(`/call_control_applications/${app.id}`, { method: "PATCH", body })).data; console.log(`updated call control app ${app.id} (webhook ${webhookUrl.replace(token || "<none>", "<token>")})`); }
  console.log(`\nbridge env: TELNYX_APP_ID=${app.id}`);
}

async function cmdConnection() {
  let c = await findConnection();
  if (!c) {
    c = (await api("/fqdn_connections", { method: "POST", body: { connection_name: CONN_NAME, transport_protocol: "TLS", encrypted_media: "SRTP", active: true, inbound: { codecs: ["OPUS", "G711U", "G711A"], sip_region: "US", ani_number_format: "+E.164", dnis_number_format: "+e164" } } })).data;
    console.log(`created connection ${c.id}`);
  } else console.log(`connection exists: ${c.id}`);
  const fqdns = await listFqdns(c.id);
  if (!fqdns.some((f) => f.fqdn === OPENAI_FQDN && Number(f.port) === OPENAI_PORT)) {
    const f = (await api("/fqdns", { method: "POST", body: { connection_id: c.id, fqdn: OPENAI_FQDN, port: OPENAI_PORT, dns_record_type: "a" } })).data;
    console.log(`added fqdn ${f.fqdn}:${f.port} (id ${f.id})`);
  } else console.log(`fqdn ${OPENAI_FQDN}:${OPENAI_PORT} already on the connection`);
}

async function cmdSearch() {
  const area = flag("--area");
  const type = flag("--type") || "local"; // local numbers: cheaper inbound minutes than toll-free
  const q = new URLSearchParams({ "filter[country_code]": "US", "filter[features][]": "voice", "filter[limit]": "10", "filter[exclude_held_numbers]": "true", "filter[phone_number_type]": type });
  if (area) q.set("filter[national_destination_code]", area);
  const rows = (await api(`/available_phone_numbers?${q.toString()}`)).data || [];
  if (!rows.length) { console.log("no numbers returned for that filter"); return; }
  for (const n of rows) {
    const ci = n.cost_information || {};
    console.log(`${n.phone_number}  upfront ${ci.upfront_cost} ${ci.currency || ""}  monthly ${ci.monthly_cost} ${ci.currency || ""}  ${(n.region_information || []).map((r) => r.region_name).filter(Boolean).join(", ")}  features ${(n.features || []).map((f) => f.name).join("/")}`);
  }
  console.log("\nto buy one (money): node scripts/ops/telnyx-gptlive-setup.mjs order <number>   (only on Alan's yes)");
}

async function cmdOrder() {
  if (!e164) throw new Error("order needs an E.164 number, e.g. +14155550123");
  const app = has("--legacy") ? null : await findApp();
  const conn = has("--legacy") ? await findConnection() : null;
  const target = app || conn;
  if (!target) throw new Error(has("--legacy") ? "no legacy connection; run: connection" : "no call control app; run: app <webhook-url>");
  const o = (await api("/number_orders", { method: "POST", body: { phone_numbers: [{ phone_number: e164 }], connection_id: target.id, customer_reference: "edgeweaver-gptlive" } })).data;
  console.log(`order ${o.id}: status ${o.status}`);
  let status = o.status;
  for (let i = 0; i < 20 && status !== "success" && status !== "failure"; i++) { await sleep(3000); status = (await api(`/number_orders/${o.id}`)).data?.status; console.log(`  order status: ${status}`); }
  if (status !== "success") throw new Error(`order did not complete: ${status}`);
  await assign(e164);
}

async function assign(number) {
  const legacy = has("--legacy");
  const target = legacy ? await findConnection() : await findApp();
  if (!target) throw new Error(legacy ? "no legacy connection; run: connection" : "no call control app; run: app <webhook-url>");
  let n = null;
  for (let i = 0; i < 10 && !n; i++) { n = await ownedNumber(number); if (!n) await sleep(2000); }
  if (!n) throw new Error(`number ${number} is not in the account yet`);
  if (n.connection_id !== target.id) { await api(`/phone_numbers/${n.id}`, { method: "PATCH", body: { connection_id: target.id } }); console.log(`assigned ${number} to ${legacy ? "connection" : "app"} ${target.id}`); }
  else console.log(`${number} already on ${legacy ? "connection" : "app"} ${target.id}`);
  if (legacy) {
    if (!PROJECT) throw new Error("OPENAI_PROJECT_ID missing in .env.local");
    await api(`/phone_numbers/${n.id}/voice`, { method: "PATCH", body: { translated_number: PROJECT } });
    const v = (await api(`/phone_numbers/${n.id}/voice`)).data;
    console.log(`translated number now: ${v.translated_number} (INVITE sip:${v.translated_number}@${OPENAI_FQDN}:${OPENAI_PORT};transport=tls)`);
  } else {
    console.log(`\nbridge env: TELNYX_APP_ID=${target.id}  TELNYX_NUMBER=${number}`);
  }
  console.log(`done: call ${number}`);
}

try {
  switch (cmd) {
    case "status": await cmdStatus(); break;
    case "app": await cmdApp(); break;
    case "connection": await cmdConnection(); break;
    case "search": await cmdSearch(); break;
    case "order": await cmdOrder(); break;
    case "assign": if (!e164) throw new Error("assign needs an E.164 number"); await assign(e164); break;
    default: console.log("usage: status | app <webhook-url> | connection | search [--area NNN] | order +1... | assign +1... [--legacy]"); process.exit(2);
  }
} catch (e) { console.error("FAILED:", e.message); process.exit(1); }
