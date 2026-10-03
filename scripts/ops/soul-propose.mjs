#!/usr/bin/env node
// soul-propose.mjs - a being proposes a soul change under its OWN GitHub identity (ops; ASCII).
// Alan 2026-10-02: Alpha pushed two proposal branches with no PR (one sat unseen six weeks)
// and every soul write ran under Alan's admin login. Now the being's bot account pushes the
// proposals/* branch to ITS OWN FORK and opens a cross-repo PR; it never holds write on the
// soul repo, so only Alan (or a seat) can merge.
//
//   node scripts/ops/soul-propose.mjs propose alpha --title "<title>" --body "<why, your words>"
//        run inside the soul checkout's proposals/<name> branch, commits already made
//   node scripts/ops/soul-propose.mjs check alpha          token is the bot's, scope, fork state
//   node scripts/ops/soul-propose.mjs credential alpha get git credential helper (internal)
//
// The token lives only in avatars/<being>/.env.local (gitignored) and is never printed,
// logged, or placed on a command line: git receives it through this script's credential
// helper mode (https://github.com only), the API through a request header. Every act first
// proves the token belongs to the bot, never to a person (Codex review 2026-10-02).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..");
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, "/");
const NL = /\r?\n/;
const BEINGS = {
  alpha: {
    repo: "open-agent-research-academy/edgeweaver-alpha-soul",
    dir: "C:/Users/agent/Project/edgeweaver-alpha-soul",
    env: join(ROOT, "avatars", "alpha", ".env.local"),
    key: "EW_ALPHA_GITHUB_TOKEN",
    bot: "edgeweaver-alpha",
  },
};

function die(msg) { console.error(`soul-propose: ${msg}`); process.exit(1); }

function being(name) {
  const B = BEINGS[name];
  if (!B) die(`unknown being "${name}" (known: ${Object.keys(BEINGS).join(", ")})`);
  return { ...B, name };
}

function token(B) {
  let text;
  try { text = readFileSync(B.env, "utf8"); } catch { die(`cannot read ${B.env}`); }
  for (const line of text.replace(/^\uFEFF/, "").split(NL)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === B.key) {
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    }
  }
  die(`${B.key} is not set in ${B.env} (run scripts/ops/set-alpha-github-token.ps1)`);
}

async function api(B, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token(B)}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "edgeweaver-soul-propose",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { status: res.status, json, text, scopes: res.headers.get("x-oauth-scopes") };
}

function git(B, args, opts = {}) {
  const r = spawnSync("git", ["-C", B.dir, ...args], { encoding: "utf8", ...opts });
  if (r.error) die(`git ${args[0]} failed to start: ${r.error.message}`);
  return r;
}

function gitOk(B, args) {
  const r = git(B, args);
  if (r.status !== 0) die(`git ${args.join(" ")} failed: ${(r.stderr || "").trim().split(NL)[0]}`);
  return r.stdout.trim();
}

async function assertBot(B) {
  const me = await api(B, "GET", "/user");
  if (me.status !== 200) die(`token rejected by GitHub (HTTP ${me.status})`);
  if (me.json?.login !== B.bot) die(`token belongs to ${me.json?.login}, expected ${B.bot}; refusing`);
  return me.json.login;
}

// The bot never holds write on the soul repo: it proposes from its own fork (FAMILY.md soul
// write model, "daemon works from a fork, PRs cross-repo"). Alan 2026-10-02, after the
// collaborator invite kept returning 404.
const forkName = (B) => `${B.bot}/${B.repo.split("/")[1]}`;

async function findFork(B) {
  const f = await api(B, "GET", `/repos/${forkName(B)}`);
  if (f.status === 404) return null;
  if (f.status !== 200) die(`cannot read ${forkName(B)} (HTTP ${f.status})`);
  // A transferred fork redirects to its new owner; accept only the bot's own copy.
  if (f.json.full_name !== forkName(B) || f.json.owner?.login !== B.bot) die(`${forkName(B)} now resolves to ${f.json.full_name}; refusing`);
  if (!f.json.fork || f.json.parent?.full_name !== B.repo) die(`${forkName(B)} exists but is not a fork of ${B.repo}; refusing`);
  return f.json.full_name;
}

async function ensureFork(B) {
  const have = await findFork(B);
  if (have) return have;
  const c = await api(B, "POST", `/repos/${B.repo}/forks`, { default_branch_only: true });
  if (c.status !== 202) die(`forking ${B.repo} failed (HTTP ${c.status}): ${c.json?.message || ""}`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const f = await findFork(B);
    if (f) { console.log(`fork created: ${f}`); return f; }
  }
  die(`fork of ${B.repo} not ready after 60s; rerun propose`);
}

async function check(B) {
  const login = await assertBot(B);
  const repo = await api(B, "GET", `/repos/${B.repo}`);
  if (repo.status !== 200) die(`${B.bot} cannot see ${B.repo} (HTTP ${repo.status})`);
  const scopes = (repo.scopes || "").split(/\s*,\s*/).filter(Boolean);
  // Classic tokens only: GitHub reports their scopes, so an insufficient one is caught here
  // instead of at Alpha's first proposal. Fine-grained tokens report none and are refused.
  if (repo.scopes == null) die("this looks like a fine-grained token; create a classic token with the public_repo scope");
  if (!scopes.some((s) => s === "public_repo" || s === "repo")) die(`token scopes are [${scopes.join(", ")}]; it needs public_repo (or repo) to fork and open PRs`);
  const fork = await findFork(B);
  console.log(`ok: token is ${login}; scopes [${scopes.join(", ")}]; can see ${B.repo}; fork ${fork || "not made yet (created at the first proposal)"}`);
}

async function propose(B, title, body) {
  if (!title) die('propose needs --title "<title>"');
  if (!body) die('propose needs --body "<why, in your words>"');
  await assertBot(B);
  const branch = gitOk(B, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!/^proposals\/[A-Za-z0-9._\/-]+$/.test(branch)) die(`current branch is "${branch}"; soul changes go on proposals/<name>, never main`);
  if (gitOk(B, ["status", "--porcelain"])) die("uncommitted changes in the soul checkout; commit them first");
  gitOk(B, ["fetch", "-q", "origin", "main"]);
  const ahead = Number(gitOk(B, ["rev-list", "--count", "origin/main..HEAD"]));
  if (!Number.isInteger(ahead) || ahead < 1) die("branch has no commits beyond origin/main; nothing to propose");
  // Push to the exact HTTPS URL, never "origin" (which could be SSH with a person's key or
  // carry a pushurl elsewhere). Refuse any URL rewrite or extra HTTP header (global or
  // URL-scoped) that could redirect the push or authenticate as someone else; their values
  // are never printed, since they can hold credentials. Exit 1 from --get-regexp = none set.
  for (const [what, re] of [["URL rewrites", "^url[.].*[.](pushinsteadof|insteadof)$"], ["extra HTTP headers", "^http[.](.*[.])?extraheader$"]]) {
    const r = git(B, ["config", "--name-only", "--get-regexp", re]);
    if (r.status === 0) die(`git ${what} are configured (${r.stdout.trim().split(NL).length} entr(ies)); refusing to push through them`);
    if (r.status !== 1) die(`could not read git config for ${what} (exit ${r.status})`);
  }
  const fork = await ensureFork(B);
  const url = `https://github.com/${fork}.git`;
  // Drop inherited helpers (Alan's credential manager); ours is the only credential source.
  const push = git(B, [
    "-c", "credential.helper=", "-c", `credential.helper=!node "${SELF}" credential ${B.name}`,
    "-c", "credential.useHttpPath=false", "-c", "credential.interactive=false",
    "push", url, `refs/heads/${branch}:refs/heads/${branch}`,
  ], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
  if (push.status !== 0) die("git push failed (see above)");
  const head = `${B.bot}:${branch}`;
  const pr = await api(B, "POST", `/repos/${B.repo}/pulls`, { title, body, head, base: "main" });
  if (pr.status === 201) { console.log(`proposal opened: ${pr.json.html_url}`); return; }
  if (pr.status === 422) {
    const open = await api(B, "GET", `/repos/${B.repo}/pulls?state=open&head=${encodeURIComponent(head)}`);
    if (open.status === 200 && open.json.length) { console.log(`branch updated; proposal already open: ${open.json[0].html_url}`); return; }
  }
  die(`opening the PR failed (HTTP ${pr.status}): ${pr.json?.message || pr.text.slice(0, 200)}`);
}

function credential(B, op) {
  // git credential helper protocol: answer "get" for https://github.com only; ignore the rest.
  if (op !== "get") return;
  const input = readFileSync(0, "utf8");
  const field = (k) => (input.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
  if (field("protocol") !== "https" || field("host") !== "github.com") return;
  process.stdout.write(`username=${B.bot}\npassword=${token(B)}\n`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, who, ...rest] = process.argv.slice(2);
if (!cmd || !who) die("usage: soul-propose.mjs propose|check|credential <being> ...");
const B = being(who);
try {
  if (cmd === "propose") await propose(B, flag(rest, "--title"), flag(rest, "--body"));
  else if (cmd === "check") await check(B);
  else if (cmd === "credential") credential(B, rest[0]);
  else die(`unknown command "${cmd}"`);
} catch (e) {
  die(e.message);
}
