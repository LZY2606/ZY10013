#!/usr/bin/env node
/**
 * Counts duplicated operator-selection entries across ucast packages.
 *
 * Metric (per packages/*\/src/**, TypeScript AST based):
 *   A. dispatch switch entries  - `case` / `default` clauses inside `switch`
 *     statements (operator dispatch logic)
 *   B. alias mapping entries    - module top-level variable declarations or
 *     object literal properties whose value is a plain reference to another
 *     binding under a DIFFERENT name (identifier or property access), e.g.
 *     `const $or = $and`, `in: interpreters.within`. Shorthand properties
 *     (`{ regexp }`) re-bind the same name, so they cannot duplicate
 *     selection logic and are not counted. Bindings inside function bodies
 *     are local variables, not operator-selection entries, so they are
 *     not counted either.
 *
 * Comments never reach the AST, so they cannot affect the numbers.
 * Test fixtures and spec files are excluded (only `src/` is scanned).
 *
 * Usage:
 *   node scripts/operator-duplication.mjs            # scan working tree
 *   node scripts/operator-duplication.mjs --git HEAD # scan a git revision
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const gitRef = process.argv.includes('--git')
  ? process.argv[process.argv.indexOf('--git') + 1]
  : null;

function listSourceFiles() {
  const args = gitRef ? ['ls-tree', '-r', '--name-only', gitRef] : ['ls-files'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function readFile(path) {
  if (gitRef) {
    return execFileSync('git', ['show', `${gitRef}:${path}`], { cwd: root, encoding: 'utf8' });
  }
  return readFileSync(join(root, path), 'utf8');
}

function isScannable(path) {
  return /^packages\/[^/]+\/src\/.+\.ts$/.test(path)
    && !path.includes('/spec/')
    && !path.includes('__fixtures__')
    && !path.includes('/fixtures/');
}

function isReference(node) {
  return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node);
}

function countInFile(path) {
  const source = ts.createSourceFile(path, readFile(path), ts.ScriptTarget.ES2020, true);
  const counts = { switchEntries: 0, aliasEntries: 0 };
  let functionDepth = 0;
  const isFunctionLike = (node) => ts.isFunctionLike(node);

  const visit = (node) => {
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      counts.switchEntries += 1;
    } else if (functionDepth === 0 && ts.isVariableDeclaration(node) && node.initializer && isReference(node.initializer)) {
      counts.aliasEntries += 1;
    } else if (functionDepth === 0 && ts.isPropertyAssignment(node) && isReference(node.initializer)) {
      counts.aliasEntries += 1;
    }
    if (isFunctionLike(node)) {
      functionDepth += 1;
      ts.forEachChild(node, visit);
      functionDepth -= 1;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return counts;
}

const perFile = [];
const totals = { switchEntries: 0, aliasEntries: 0 };

for (const path of listSourceFiles().filter(isScannable)) {
  const counts = countInFile(path);
  if (counts.switchEntries + counts.aliasEntries > 0) {
    perFile.push([path, counts]);
  }
  totals.switchEntries += counts.switchEntries;
  totals.aliasEntries += counts.aliasEntries;
}

const total = totals.switchEntries + totals.aliasEntries;
const label = gitRef ? `git revision ${gitRef}` : 'working tree';

console.log(`Operator-selection duplication report (${label})`);
console.log('Scanned: packages/*/src/**/*.ts (spec files and fixtures excluded; comments are not part of the AST)');
console.log('');
for (const [path, counts] of perFile) {
  console.log(
    `  ${path.padEnd(48)} switch=${counts.switchEntries} alias=${counts.aliasEntries} total=${counts.switchEntries + counts.aliasEntries}`
  );
}
console.log('');
console.log(`  dispatch switch entries (case/default clauses): ${totals.switchEntries}`);
console.log(`  alias mapping entries (reference-valued):       ${totals.aliasEntries}`);
console.log(`  TOTAL duplicated selection entries:             ${total}`);
