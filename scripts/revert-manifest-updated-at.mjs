#!/usr/bin/env node
/**
 * Revert `updatedAt`-only churn in the config asset manifest.
 *
 * `npm run update-manifest` re-stamps every entry whose hash it recomputes
 * against a baseline other than the committed manifest — notably after the
 * manifest is reset to an older release tag to prune dead `oldHashes` — so
 * entries whose content has not changed since the last commit still show a new
 * timestamp. This script compares the working manifest against a base git ref
 * entry-by-entry and restores the base `updatedAt` value for every entry whose
 * `hash` is unchanged. `oldHashes` is deliberately not compared: pruning
 * rewrites that list for assets whose bundled bytes are identical to the base,
 * and `hash` alone is what pins the content.
 *
 * Pass a base ref whose manifest already records the current asset content —
 * normally `HEAD`, the default. Do not pass the tag the manifest was reset
 * from: against that base every remaining difference is a real content change,
 * so the comparison can never find anything to revert.
 *
 * Usage (run from anywhere inside the hiyori-app repo; requires js-yaml from
 * the repo's node_modules):
 *
 *   node revert-manifest-updated-at.mjs [options]
 *
 * Options:
 *   --file <path>   Manifest path relative to the repo root
 *                   (default: src/lib/fs/config-assets-manifest.yaml)
 *   --ref <gitref>  Base git ref whose manifest already records the current
 *                   asset content (default: HEAD — not the prune anchor tag)
 *   --dry-run       Report candidates without writing the file
 *   --help          Show this help
 *
 * Manifest assumptions (match scripts/update-config-manifest.mjs output):
 *   - entries are nested maps identified by a `configPath: <path>` line
 *   - each entry's `updatedAt:` line appears after its `configPath:` line and
 *     before the next entry's `configPath:` line
 *   - the file uses LF line endings
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const DEFAULT_FILE = "src/lib/fs/config-assets-manifest.yaml";

function usage() {
  console.log(
    "Usage: node revert-manifest-updated-at.mjs [--file <path>] [--ref <gitref>] [--dry-run]",
  );
}

function parseArgs(argv) {
  const opts = { file: DEFAULT_FILE, ref: "HEAD", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--file") {
      opts.file = argv[++i];
      if (!opts.file) fail("--file requires a value");
    } else if (arg === "--ref") {
      opts.ref = argv[++i];
      if (!opts.ref) fail("--ref requires a value");
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  console.error(`Error: ${message}`);
  usage();
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    fail(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

const opts = parseArgs(process.argv.slice(2));

const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();

let yaml;
try {
  yaml = createRequire(join(repoRoot, "package.json"))("js-yaml");
} catch {
  fail(
    `js-yaml not found in ${repoRoot}/node_modules — run from a repo checkout with dependencies installed`,
  );
}

const manifestPath = join(repoRoot, opts.file);
let baseText;
try {
  baseText = git(["show", `${opts.ref}:${opts.file}`]);
} catch {
  fail(`cannot read ${opts.file} at ref ${opts.ref}`);
}
let currText;
try {
  currText = readFileSync(manifestPath, "utf-8");
} catch {
  fail(`cannot read working file ${manifestPath}`);
}

if (baseText === currText) {
  console.log(
    `No differences between ${opts.ref}:${opts.file} and the working file — nothing to do.`,
  );
  process.exit(0);
}

/** Collect all manifest entries (objects carrying a `configPath`) into a map keyed by configPath. */
function flatten(node, out = new Map()) {
  if (node == null || typeof node !== "object") return out;
  if (typeof node.configPath === "string") {
    out.set(node.configPath, node);
    return out;
  }
  for (const value of Object.values(node)) flatten(value, out);
  return out;
}

// JSON_SCHEMA keeps timestamps as strings (the default schema parses them into Date objects).
const baseEntries = flatten(yaml.load(baseText, { schema: yaml.JSON_SCHEMA }));
const currEntries = flatten(yaml.load(currText, { schema: yaml.JSON_SCHEMA }));

/** An entry is an updatedAt-only change when its `hash` matches the base but `updatedAt` differs. */
const candidates = [];
for (const [path, curr] of currEntries) {
  const base = baseEntries.get(path);
  if (!base) continue;
  // `oldHashes` is not compared: a prune rewrites it without touching content.
  if (base.hash === curr.hash && base.updatedAt !== curr.updatedAt) {
    candidates.push({ path, from: curr.updatedAt, to: base.updatedAt });
  }
}

if (candidates.length === 0) {
  console.log("No updatedAt-only changes found — nothing to revert.");
  process.exit(0);
}

/** Locate the `updatedAt:` line of the entry identified by `configPath` (see header assumptions). */
function findUpdatedAtIndex(lines, configPath) {
  const variants = [
    `configPath: ${configPath}`,
    `configPath: "${configPath}"`,
    `configPath: '${configPath}'`,
  ];
  const start = lines.findIndex((line) => variants.includes(line.trim()));
  if (start === -1) return -1;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("configPath:")) return -1;
    if (trimmed.startsWith("updatedAt:")) return i;
  }
  return -1;
}

const baseLines = baseText.split("\n");
const outLines = currText.split("\n");
let reverted = 0;
for (const { path, from, to } of candidates) {
  const baseIndex = findUpdatedAtIndex(baseLines, path);
  const targetIndex = findUpdatedAtIndex(outLines, path);
  if (baseIndex === -1 || targetIndex === -1) {
    console.log(`SKIP (updatedAt line not located): ${path}`);
    continue;
  }
  const indent = outLines[targetIndex].match(/^\s*/)[0];
  outLines[targetIndex] = `${indent}${baseLines[baseIndex].trim()}`;
  reverted++;
  console.log(
    `${opts.dryRun ? "would revert" : "reverted"} ${path} (${from} -> ${to})`,
  );
}

if (opts.dryRun) {
  console.log(
    `\nDry run: ${reverted} of ${candidates.length} entries would be reverted. No file written.`,
  );
} else {
  writeFileSync(manifestPath, outLines.join("\n"), "utf-8");
  console.log(
    `\nReverted updatedAt for ${reverted} of ${candidates.length} entries in ${opts.file}.`,
  );
}
