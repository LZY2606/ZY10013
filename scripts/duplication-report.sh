#!/usr/bin/env bash
# Reproducible before/after operator-selection duplication report.
# Baseline ("before") is extracted from the committed git HEAD; "after" is
# the current working tree. Only packages/*/src runtime files are parsed with
# the TypeScript compiler API, so comments and test fixtures are excluded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COUNTER="$ROOT/scripts/count-duplication.mjs"
SNAPSHOT="${SNAPSHOT_REF:-HEAD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$ROOT" archive "$SNAPSHOT" | tar -x -C "$TMP"

echo "== before ($SNAPSHOT) =="
node "$COUNTER" "$TMP" --no-items
echo
echo "== after (working tree) =="
node "$COUNTER" "$ROOT" --no-items
echo

node --input-type=module -e '
import { execSync } from "node:child_process";
const root = process.argv[1];
const tmp = process.argv[2];
const run = (cwd) => JSON.parse(execSync(`node ${root}/scripts/count-duplication.mjs ${cwd} --json`, { encoding: "utf8" }).replaceAll(cwd, cwd));
const before = run(tmp);
const after = run(root);
const reduction = ((before.totals.total - after.totals.total) / before.totals.total * 100);
console.log("== summary ==");
for (const key of ["A","B","C","D","E"]) {
  console.log(`${key}: ${before.totals[key]} -> ${after.totals[key]}`);
}
console.log(`total: ${before.totals.total} -> ${after.totals.total} (${reduction.toFixed(1)}% reduction)`);
if (reduction < 30) { console.error("FAILED: reduction below 30%"); process.exit(1); }
' "$ROOT" "$TMP"
