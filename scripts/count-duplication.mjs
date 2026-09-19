#!/usr/bin/env node
/**
 * Operator-selection duplication counter for UCAST packages.
 *
 * Counts duplicated "operator selection logic" in runtime source only:
 *   A. dispatch switch cases          — switch/case branches that select an
 *                                       operator interpreter by arity/name
 *   B. alias mapping entries          — object/record entries pointing one
 *                                       operator name at another entry
 *   C. alias const bindings           — `export const x = y` operator aliases
 *   D. registry assembly callbacks     — `.reduce(...)` builds of operator maps
 *   E. name normalization callbacks    — per-parser `operatorToConditionName`
 *
 * Inputs are parsed with the TypeScript compiler API, so comments, type
 * annotations and test fixtures (only package src directories are scanned) are never
 * counted.
 *
 * Usage:
 *   node scripts/count-duplication.mjs [repoRoot] [--json] [--no-items]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : process.cwd();
const asJson = process.argv.includes('--json');
const listItems = !process.argv.includes('--no-items');

const CATEGORY_LABELS = {
  A: 'dispatch switch cases',
  B: 'alias mapping entries',
  C: 'alias const bindings',
  D: 'registry assembly callbacks',
  E: 'name normalization callbacks',
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

function sourceFiles() {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir).flatMap(name => {
    const src = join(packagesDir, name, 'src');
    return existsSync(src) ? walk(src) : [];
  });
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function snippet(sf, node) {
  return sf.text.slice(node.getStart(sf), node.getEnd(sf))
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isOperatorRegistryFile(file) {
  return /\/(interpreter|defaults)\.ts?$|\/interpreters\.ts$|\/ObjectQueryParser\.ts$|\/MongoQueryParser\.ts$|\/factory\.ts$/.test(file);
}

function findAliasedName(expression, localNames) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    if (expression.expression.kind === ts.SyntaxKind.ThisKeyword) return null;
    return expression.name.text;
  }
  return null;
}

function countFile(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const items = [];
  const add = (category, node, detail) => {
    items.push({ category, file: relative(root, file), line: lineOf(sf, node), detail: detail || snippet(sf, node) });
  };

  const localOperatorNames = new Set();
  sf.forEachChild(function collect(node) {
    if (ts.isFunctionDeclaration(node) && node.name) localOperatorNames.add(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) localOperatorNames.add(decl.name.text);
      }
    }
    ts.forEachChild(node, collect);
  });

  function visit(node) {
    if (ts.isSwitchStatement(node) && isOperatorRegistryFile(file)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) add('A', clause);
      }
    }

    if (ts.isVariableStatement(node) && isOperatorRegistryFile(file)) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          /interpreter|instruction/i.test(decl.name.getText(sf))
        ) {
          for (const prop of decl.initializer.properties) {
            if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
              const target = findAliasedName(prop.initializer, localOperatorNames);
              if (target && target !== prop.name.text) add('B', prop, `${prop.name.text} -> ${target}`);
            }
          }
        }
      }
    }

    if (/\/(instructions|interpreters)\.ts$/.test(file) && ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isIdentifier(decl.initializer) &&
          localOperatorNames.has(decl.initializer.text) &&
          decl.initializer.text !== decl.name.getText(sf) &&
          /^\$?[a-z][A-Za-z]*$/.test(decl.name.getText(sf))
        ) {
          add('C', decl, `${decl.name.getText(sf)} = ${decl.initializer.text}`);
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (
        node.expression.name.text === 'reduce' &&
        isOperatorRegistryFile(file) &&
        node.arguments.length > 0
      ) {
        const bodyText = node.arguments[0].getText(sf);
        if (/instructions|interpreters|operator/i.test(bodyText)) {
          add('D', node);
        }
      }
    }

    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'operatorToConditionName') {
      add('E', node);
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
  return items;
}

const all = sourceFiles().flatMap(countFile).sort((a, b) => {
  return a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;
});
const totals = { A: 0, B: 0, C: 0, D: 0, E: 0 };
for (const item of all) totals[item.category]++;
totals.total = all.length;

if (asJson) {
  console.log(JSON.stringify({ root, totals, items: all }, null, 2));
} else {
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    console.log(`${key}. ${label}: ${totals[key]}`);
  }
  console.log(`\ntotal: ${totals.total}`);
  if (listItems) {
    for (const item of all) {
      console.log(`  [${item.category}] ${item.file}:${item.line}  ${item.detail}`);
    }
  }
}
