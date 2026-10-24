// db.mjs - the side-effect half of the fleet tools: locate psql (PATH, then scoop shims),
// run SQL files/commands against a connection URL, run \copy pairs, and parse simple query
// output. Everything here takes explicit dbUrl arguments; profile resolution stays in
// profiles.mjs and SQL generation stays in sql-gen.mjs, so --dry-run paths never import a
// working psql. ON_ERROR_STOP everywhere: a failed statement fails the tool.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

let PSQL = null;
export function psqlPath() {
  if (PSQL) return PSQL;
  const candidates = ["psql", join(homedir(), "scoop", "shims", "psql.exe"),
    join(homedir(), "scoop", "apps", "postgresql", "current", "bin", "psql.exe"),
    ...installerBins("psql.exe")];
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); PSQL = c; return c; } catch { /* next */ }
  }
  throw new Error("psql not found (PATH, scoop, or Program Files\\PostgreSQL). Install: scoop install postgresql");
}

// The EDB installer (winget PostgreSQL.PostgreSQL.<n>) lands in Program Files\PostgreSQL\<n>\bin
// and does not touch PATH; processes launched before a PATH change still need to find it.
function installerBins(exe) {
  return ["18", "17", "16"].map((v) => join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", v, "bin", exe));
}

// pg_restore is only needed by the past-brain spawn (--from-dump) when the decrypted nightly
// backup is in pg_dump's CUSTOM format (magic "PGDMP"): pg_restore -f converts it to plain SQL
// with NO database connection. Same candidate order as psqlPath (PATH, scoop shims, scoop apps).
let PGRESTORE = null;
export function pgRestorePath() {
  if (PGRESTORE) return PGRESTORE;
  const candidates = ["pg_restore", join(homedir(), "scoop", "shims", "pg_restore.exe"),
    join(homedir(), "scoop", "apps", "postgresql", "current", "bin", "pg_restore.exe"),
    ...installerBins("pg_restore.exe")];
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); PGRESTORE = c; return c; } catch { /* next */ }
  }
  throw new Error("pg_restore not found (PATH or scoop shims). Install: scoop install postgresql");
}

// Convert a custom-format dump to a plain-SQL string via pg_restore -f (local, no connection).
// -f writes to a temp file (pg_restore cannot stream plain SQL to stdout portably); we read it
// back and delete it. A dump path carries no credentials, so no redaction is needed here.
export function pgRestoreToPlain(dumpPath) {
  const dir = mkdtempSync(join(tmpdir(), "ew-restore-"));
  const out = join(dir, "restored.sql");
  try {
    execFileSync(pgRestorePath(), ["-f", out, dumpPath], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return readFileSync(out, "utf8");
  } catch (e) {
    const detail = ((e.stderr || "") + (e.stdout || "")).trim() || "pg_restore exited " + (e.status ?? "?");
    throw new Error("pg_restore failed: " + detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Connection URLs carry credentials: exec errors are rethrown with ONLY psql's own
// stderr/stdout, never the command line, and any URL that slips through is redacted.
const redact = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, "postgresql://<redacted>");
function run(dbUrl, args, opts = {}) {
  try {
    return execFileSync(psqlPath(), ["-X", "-v", "ON_ERROR_STOP=1", "-d", dbUrl, ...args], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts,
    });
  } catch (e) {
    const detail = ((e.stderr || "") + (e.stdout || "")).trim() || "psql exited " + (e.status ?? "?");
    throw new Error("psql failed: " + redact(detail));
  }
}

export function runSqlFile(dbUrl, path) { return run(dbUrl, ["-q", "-f", path]); }

export function runSqlText(dbUrl, sql, label = "stmt") {
  const dir = mkdtempSync(join(tmpdir(), "ew-brains-"));
  const f = join(dir, label + ".sql");
  try { writeFileSync(f, sql, "utf8"); return runSqlFile(dbUrl, f); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// -A -t: unaligned, tuples only. Returns array of rows, each an array of column strings.
export function query(dbUrl, sql) {
  const out = run(dbUrl, ["-A", "-t", "-c", sql]);
  return out.split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
}

export function runMeta(dbUrl, metaCommand) { return run(dbUrl, ["-q", "-c", metaCommand]); }

export function makeWorkDir() { return mkdtempSync(join(tmpdir(), "ew-spawn-")); }
export function cleanWorkDir(dir) { if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true }); }
