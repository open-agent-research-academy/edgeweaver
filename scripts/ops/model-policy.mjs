#!/usr/bin/env node
// Fleet model policy: ONE place that says which model and effort every agent runs.
//
// Read by every launcher at start (channel sessions, hourly wakes, room replies, Buzz
// presences, and the Staff Program's Jarvis/Samantha wrappers), written by the
// Telegram fleet console (fleet-console.mjs, /mind) or by hand with this CLI.
//
//   node scripts/ops/model-policy.mjs show                       table of every agent/role
//   node scripts/ops/model-policy.mjs get  <agent> [role]        JSON {model, effort}
//   node scripts/ops/model-policy.mjs args <agent> [role]        "--model X --effort Y" (launchers)
//   node scripts/ops/model-policy.mjs set  <agent|all> [role] <model> [effort]
//   node scripts/ops/model-policy.mjs reset                      drop live overrides (back to defaults)
//
// Model aliases: opus, fable, sonnet, haiku (or any full id). Effort: low, medium, high,
// xhigh, max. Role omitted on `set` means every role of that agent EXCEPT night (the
// night loops are a deliberate cost choice; name the role to change them).
//
// A change takes effect the next time a launcher runs. Headless roles (hourly, room,
// night) pick it up on their next tick; a live channel session keeps its model until it
// is restarted, because model and effort are session-scoped (see restore-channel-model.ps1).
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_PATH = join(repo, "scripts", "ops", "model-policy.default.json");
export const LIVE_PATH = process.env.FLEET_MODEL_POLICY || join(repo, "state", "model-policy.json");

export const ALIASES = {
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function loadPolicy() {
  const def = readJson(DEFAULT_PATH) || { defaults: { model: "claude-opus-5-5", effort: "medium" }, agents: {} };
  const live = readJson(LIVE_PATH) || {};
  const merged = {
    version: 1,
    defaults: { ...def.defaults, ...(live.defaults || {}) },
    agents: {},
    updated: live.updated || null,
    updatedBy: live.updatedBy || null,
  };
  const names = new Set([...Object.keys(def.agents || {}), ...Object.keys(live.agents || {})]);
  for (const a of names) {
    const roles = new Set([...Object.keys(def.agents?.[a] || {}), ...Object.keys(live.agents?.[a] || {})]);
    merged.agents[a] = {};
    for (const r of roles) merged.agents[a][r] = { ...(def.agents?.[a]?.[r] || {}), ...(live.agents?.[a]?.[r] || {}) };
  }
  return merged;
}

export function normalizeModel(m) {
  if (!m) return null;
  const k = String(m).toLowerCase().trim();
  if (ALIASES[k]) return ALIASES[k];
  if (/^claude-[a-z0-9-]+(\[1m\])?$/.test(k)) return k;
  return null;
}
export function normalizeEffort(e) {
  if (!e) return null;
  const k = String(e).toLowerCase().trim();
  return EFFORTS.includes(k) ? k : null;
}

export function resolve(agent, role = "channel", policy = loadPolicy()) {
  const a = policy.agents[agent];
  if (!a) throw new Error(`unknown agent '${agent}' (known: ${Object.keys(policy.agents).join(", ")})`);
  const r = a[role];
  if (!r) throw new Error(`agent '${agent}' has no role '${role}' (roles: ${Object.keys(a).join(", ")})`);
  return { model: r.model || policy.defaults.model, effort: r.effort || policy.defaults.effort };
}

export function setPolicy({ agent, role, model, effort, by = "cli" }) {
  const policy = loadPolicy();
  const targets = agent === "all" ? Object.keys(policy.agents) : [agent];
  for (const t of targets) if (!policy.agents[t]) throw new Error(`unknown agent '${t}' (known: ${Object.keys(policy.agents).join(", ")}, all)`);
  const live = readJson(LIVE_PATH) || { version: 1, agents: {} };
  live.agents ||= {};
  const changed = [];
  for (const t of targets) {
    const roles = role ? [role] : Object.keys(policy.agents[t]).filter((r) => r !== "night");
    for (const r of roles) {
      if (!policy.agents[t][r]) {
        if (agent === "all") continue; // "all night" only touches agents that have a night role
        throw new Error(`agent '${t}' has no role '${r}' (roles: ${Object.keys(policy.agents[t]).join(", ")})`);
      }
      live.agents[t] ||= {};
      const cur = live.agents[t][r] || {};
      if (model) cur.model = model;
      if (effort) cur.effort = effort;
      live.agents[t][r] = cur;
      changed.push(`${t}.${r}`);
    }
  }
  live.updated = new Date().toISOString();
  live.updatedBy = by;
  mkdirSync(dirname(LIVE_PATH), { recursive: true });
  const tmp = LIVE_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(live, null, 2) + "\n");
  renameSync(tmp, LIVE_PATH);
  return { changed, policy: loadPolicy() };
}

export function resetPolicy() {
  if (existsSync(LIVE_PATH)) renameSync(LIVE_PATH, LIVE_PATH + ".bak-" + Date.now());
  return loadPolicy();
}

export function table(policy = loadPolicy()) {
  const lines = [];
  for (const [a, roles] of Object.entries(policy.agents)) {
    for (const r of Object.keys(roles)) {
      const { model, effort } = resolve(a, r, policy);
      lines.push(`${a.padEnd(11)} ${r.padEnd(8)} ${model.padEnd(18)} ${effort}`);
    }
  }
  return lines.join("\n");
}

// Parse "<agent|all> [role] <model> [effort]" (shared by the CLI and the Telegram console).
export function parseSet(words) {
  const agent = (words[0] || "").toLowerCase();
  let i = 1, role = null;
  if (words[i] && !normalizeModel(words[i]) && !normalizeEffort(words[i])) role = words[i++].toLowerCase();
  const model = normalizeModel(words[i]) ? normalizeModel(words[i++]) : null;
  const effort = normalizeEffort(words[i]) ? normalizeEffort(words[i++]) : null;
  if (!agent) throw new Error("usage: <agent|all> [role] <model> [effort]");
  if (!model && !effort) throw new Error(`no model or effort recognised in '${words.slice(1).join(" ")}' (models: ${Object.keys(ALIASES).join(", ")} or a claude-* id; efforts: ${EFFORTS.join(", ")})`);
  return { agent, role, model, effort, rest: words.slice(i) };
}

// ---- CLI ----
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "show" || !cmd) {
      const p = loadPolicy();
      console.log(table(p));
      console.log(`\n(defaults ${p.defaults.model} ${p.defaults.effort}; live overrides: ${existsSync(LIVE_PATH) ? LIVE_PATH + (p.updated ? " updated " + p.updated + " by " + p.updatedBy : "") : "none"})`);
    } else if (cmd === "get") {
      console.log(JSON.stringify(resolve(rest[0], rest[1] || "channel")));
    } else if (cmd === "args") {
      const { model, effort } = resolve(rest[0], rest[1] || "channel");
      process.stdout.write(`--model ${model} --effort ${effort}`);
    } else if (cmd === "set") {
      const { agent, role, model, effort } = parseSet(rest);
      const { changed } = setPolicy({ agent, role, model, effort });
      console.log(`set ${changed.join(", ")} -> ${[model, effort].filter(Boolean).join(" ")}`);
      console.log(table());
    } else if (cmd === "reset") {
      resetPolicy();
      console.log(table());
    } else {
      throw new Error(`unknown command '${cmd}'`);
    }
  } catch (e) {
    console.error(`model-policy: ${e.message}`);
    process.exit(1);
  }
}
