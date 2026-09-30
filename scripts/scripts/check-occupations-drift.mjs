#!/usr/bin/env node
/**
 * Fails if data/occupations.json and the OCCUPATION_GUIDE object embedded in
 * index.html disagree. The two must be byte-identical after normalization,
 * because they are the same data duplicated for offline-safe delivery.
 *
 * To fix a failure: edit data/occupations.json (source of truth), then
 * regenerate the inline block in index.html by copying the JSON verbatim
 * between the two marker comments:
 *   // === OCCUPATION_GUIDE_START ===
 *   const OCCUPATION_GUIDE = { ... };
 *   // === OCCUPATION_GUIDE_END ===
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const jsonPath = join(root, 'data', 'occupations.json');
const htmlPath = join(root, 'index.html');

const canonicalize = (value) => {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
};

const extractInline = (html) => {
  const start = html.indexOf('// === OCCUPATION_GUIDE_START ===');
  const end = html.indexOf('// === OCCUPATION_GUIDE_END ===');
  if (start === -1 || end === -1) {
    throw new Error(
      'index.html is missing OCCUPATION_GUIDE markers.\n' +
      'Wrap the inline object with:\n' +
      '  // === OCCUPATION_GUIDE_START ===\n' +
      '  const OCCUPATION_GUIDE = { ... };\n' +
      '  // === OCCUPATION_GUIDE_END ==='
    );
  }
  const block = html.slice(start, end);
  const eq = block.indexOf('=');
  const braceStart = block.indexOf('{', eq);
  if (braceStart === -1) throw new Error('No "{" found after OCCUPATION_GUIDE =');
  let depth = 0, inStr = null, esc = false;
  for (let i = braceStart; i < block.length; i++) {
    const ch = block[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === inStr) { inStr = null; continue; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return block.slice(braceStart, i + 1);
    }
  }
  throw new Error('Unbalanced braces in OCCUPATION_GUIDE block');
};

const main = async () => {
  const jsonRaw = await readFile(jsonPath, 'utf8');
  const htmlRaw = await readFile(htmlPath, 'utf8');

  const jsonObj = JSON.parse(jsonRaw);
  const inlineSrc = extractInline(htmlRaw);

  let inlineObj;
  try {
    inlineObj = new Function('return (' + inlineSrc + ');')();
  } catch (err) {
    console.error('Could not evaluate inline OCCUPATION_GUIDE:', err.message);
    process.exit(1);
  }

  const pick = (o) => ({
    metadata: o.metadata,
    categories: o.categories,
    otherCategories: o.otherCategories
  });

  const a = canonicalize(pick(jsonObj));
  const b = canonicalize(pick(inlineObj));

  if (a !== b) {
    console.error('DRIFT DETECTED between data/occupations.json and index.html.');
    console.error('');
    console.error('The occupation data in the two files must match exactly.');
    console.error('Edit data/occupations.json (source of truth), then copy its');
    console.error('contents into the OCCUPATION_GUIDE block in index.html.');
    console.error('');
    const summarize = (o) => o.categories.map(c => `${c.id}:${c.occupations.length}`).join(', ');
    console.error('JSON file  :', summarize(pick(jsonObj)));
    console.error('index.html :', summarize(pick(inlineObj)));
    process.exit(1);
  }

  console.log('OK: occupation data matches between JSON and index.html.');
  console.log('Categories:', jsonObj.categories.map(c => `${c.id}(${c.occupations.length})`).join(' '));
};

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
