// telnyx-gptlive-setup.mjs - wire a Telnyx number to OpenAI GPT-Live over SIP (inbound), by API.
//
// Mirrors Telnyx's own GPT-Live guide (developers.telnyx.com/docs/voice/sip-trunking/gpt-live-configuration-guide):
// an FQDN connection (TLS signalling, SRTP media, Opus + G.711) whose FQDN is sip.api.openai.com:5061,
// a voice number assigned to it, and the number's "translated number" set to the OpenAI project id,
// so Telnyx INVITEs sip:proj_...@sip.api.openai.com. OpenAI then fires live.transport.incoming at
// our webhook (scripts/test-mode/gpt-live-server.mjs) which accepts and attaches the mind.
//
// Account creation, billing and the API key are Alan's hands (the key arrives via the masked window
// into .env.local as TELNYX_API_KEY). Buying a number spends money: `order` is run only after Alan
// says yes to a specific number and its price printed by `search`.
//
// Usage: node scripts/ops/telnyx-gptlive-setup.mjs <command>
//   status                 balance, connections, FQDNs, numbers (read-only)
//   connection             create the FQDN connection + FQDN if missing (idempotent)
//   search [--area 415]    list buyable US voice numbers with prices (read-only)
//   order +1XXXXXXXXXX     BUY that number (money), then assign it (needs OPENAI_PROJECT_ID)
//   assign +1XXXXXXXXXX    attach an owned number to the connection + set translated number
// Env (.env.local): TELNYX_API_KEY (required), OPENAI_PROJECT_ID (for assign/order),
//   EW_TELNYX_CONNECTION_NAME (default "Edgeweaver GPT-Live").

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries((await readFile(join(ROOT, ".env.local"), "utf8"))
  .split(/\r?\n/).map((l) => l.match(/^([A-Za-z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const KEY = env.TELNYX_API_KEY;
const PROJECT = env.OPENAI_PROJECT_ID || "";
const NAME = env.EW_TELNYX_CONNECTION_NAME || "Edgeweaver GPT-Live";
const OPENAI_FQDN = "sip.api.openai.com", OPENAI_PORT = 5061;
if (!KEY) { console.error("TELNYX_API_KEY missing in .env.local (use the masked-secret-entry window)"); process.exit(2); }

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

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

async function findConnection() {
  const j = await api(`/fqdn_connections?filter[connection_name][contains]=${encodeURIComponent(NAME)}&page[size]=50`);
  return (j.data || []).find((c) => c.connection_name === NAME) || null;
}
async function listFqdns(connectionId) {
  const j = await api(`/fqdns?filter[connection_id]=${encodeURIComponent(connectionId)}&page[size]=50`);
  return j.data || [];
}
async function ownedNumber(number) {
  const j = await api(`/phone_numbers?filter[phone_number]=${encodeURIComponent(number)}`);
  return (j.data || [])[0] || null;
}

async function cmdStatus() {
  try { const b = await api("/balance"); console.log(`balance: ${b.data?.balance} ${b.data?.currency} (credit limit ${b.data?.credit_limit})`); }
  catch (e) { console.log("balance: " + e.message); }
  const c = await findConnection();
  console.log(c ? `connection "${NAME}": id ${c.id}, transport ${c.transport_protocol}, media ${c.encrypted_media || "none"}, active ${c.active}` : `connection "${NAME}": MISSING (run: connection)`);
  if (c) for (const f of await listFqdns(c.id)) console.log(`  fqdn ${f.fqdn}:${f.port} (${f.dns_record_type}) id ${f.id}`);
  const nums = await api("/phone_numbers?page[size]=50");
  for (const n of nums.data || []) console.log(`number ${n.phone_number}: status ${n.status}, connection ${n.connection_id || "none"}${n.connection_id && c && n.connection_id === c.id ? " (this one)" : ""}`);
  if (!(nums.data || []).length) console.log("numbers: none owned");
  console.log(`openai project id: ${PROJECT || "NOT SET (OPENAI_PROJECT_ID)"}`);
}

async function cmdConnection() {
  let c = await findConnection();
  if (!c) {
    c = (await api("/fqdn_connections", { method: "POST", body: {
      connection_name: NAME, transport_protocol: "TLS", encrypted_media: "SRTP", active: true,
      inbound: { codecs: ["OPUS", "G711U", "G711A"], sip_region: "US", ani_number_format: "+E.164", dnis_number_format: "+e164" },
    } })).data;
    console.log(`created connection ${c.id}`);
  } else console.log(`connection exists: ${c.id}`);
  const fqdns = await listFqdns(c.id);
  if (!fqdns.some((f) => f.fqdn === OPENAI_FQDN && Number(f.port) === OPENAI_PORT)) {
    const f = (await api("/fqdns", { method: "POST", body: { connection_id: c.id, fqdn: OPENAI_FQDN, port: OPENAI_PORT, dns_record_type: "a" } })).data;
    console.log(`added fqdn ${f.fqdn}:${f.port} (id ${f.id})`);
  } else console.log(`fqdn ${OPENAI_FQDN}:${OPENAI_PORT} already on the connection`);
  console.log("done: connection", c.id);
}

async function cmdSearch() {
  const area = flag("--area");
  const q = new URLSearchParams({ "filter[country_code]": "US", "filter[features][]": "voice", "filter[limit]": "10", "filter[exclude_held_numbers]": "true" });
  if (area) q.set("filter[national_destination_code]", area);
  const j = await api(`/available_phone_numbers?${q.toString()}`);
  const rows = j.data || [];
  if (!rows.length) { console.log("no numbers returned for that filter"); return; }
  for (const n of rows) {
    const ci = n.cost_information || {};
    console.log(`${n.phone_number}  upfront ${ci.upfront_cost} ${ci.currency || ""}  monthly ${ci.monthly_cost} ${ci.currency || ""}  ${n.region_information?.map((r) => r.region_name).filter(Boolean).join(", ") || ""}  features ${(n.features || []).map((f) => f.name).join("/")}`);
  }
  console.log("\nto buy one (money): node scripts/ops/telnyx-gptlive-setup.mjs order <number>   (only on Alan's yes)");
}

async function cmdOrder() {
  const number = args.find((a) => /^\+\d{8,15}$/.test(a));
  if (!number) throw new Error("order needs an E.164 number, e.g. +14155550123");
  const c = await findConnection();
  if (!c) throw new Error("no connection yet; run: connection");
  const o = (await api("/number_orders", { method: "POST", body: { phone_numbers: [{ phone_number: number }], connection_id: c.id, customer_reference: "edgeweaver-gptlive" } })).data;
  console.log(`order ${o.id}: status ${o.status}`);
  let status = o.status;
  for (let i = 0; i < 20 && status !== "success" && status !== "failure"; i++) {
    await sleep(3000);
    status = (await api(`/number_orders/${o.id}`)).data?.status;
    console.log(`  order status: ${status}`);
  }
  if (status !== "success") throw new Error(`order did not complete: ${status}`);
  await assign(number, c);
}

async function assign(number, c) {
  c = c || (await findConnection());
  if (!c) throw new Error("no connection yet; run: connection");
  if (!PROJECT) throw new Error("OPENAI_PROJECT_ID missing in .env.local (proj_... from platform.openai.com Settings > General)");
  let n = null;
  for (let i = 0; i < 10 && !n; i++) { n = await ownedNumber(number); if (!n) await sleep(2000); }
  if (!n) throw new Error(`number ${number} is not in the account yet`);
  if (n.connection_id !== c.id) { await api(`/phone_numbers/${n.id}`, { method: "PATCH", body: { connection_id: c.id } }); console.log(`assigned ${number} to connection ${c.id}`); }
  else console.log(`${number} already on connection ${c.id}`);
  await api(`/phone_numbers/${n.id}/voice`, { method: "PATCH", body: { translated_number: PROJECT } });
  const v = (await api(`/phone_numbers/${n.id}/voice`)).data;
  console.log(`translated number now: ${v.translated_number}  (calls will INVITE sip:${v.translated_number}@${OPENAI_FQDN}:${OPENAI_PORT};transport=tls)`);
  console.log(`done: call ${number}`);
}

async function cmdAssign() {
  const number = args.find((a) => /^\+\d{8,15}$/.test(a));
  if (!number) throw new Error("assign needs an E.164 number");
  await assign(number);
}

try {
  switch (cmd) {
    case "status": await cmdStatus(); break;
    case "connection": await cmdConnection(); break;
    case "search": await cmdSearch(); break;
    case "order": await cmdOrder(); break;
    case "assign": await cmdAssign(); break;
    default: console.log("usage: status | connection | search [--area NNN] | order +1... | assign +1..."); process.exit(2);
  }
} catch (e) { console.error("FAILED:", e.message); process.exit(1); }
