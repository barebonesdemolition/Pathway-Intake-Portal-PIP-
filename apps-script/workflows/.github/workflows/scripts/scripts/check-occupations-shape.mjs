#!/usr/bin/env node
/**
 * Structural validation of data/occupations.json.
 * Fails if any of these invariants are broken:
 *   - top-level metadata + categories + otherCategories present
 *   - every category has id, label, occupation_count, occupations[]
 *   - occupation_count matches occupations.length
 *   - every NOC is exactly 5 digits
 *   - every TEER is between 0 and 5
 *   - no duplicate NOC codes across the whole file
 *   - total occupations = 37 + 11 + 5 + 4 = 57
 *   - source_checked is a valid ISO date
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsonPath = join(root, 'data', 'occupations.json');

const EXPECTED_TOTAL = 57;
const EXPECTED_PER_CATEGORY = { healthcare: 37, stem: 11, education: 5, transport: 4 };

const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };

const main = async () => {
  const raw = await readFile(jsonPath, 'utf8');
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { fail('occupations.json is not valid JSON: ' + e.message); }

  if (!data.metadata || typeof data.metadata !== 'object') fail('metadata missing');
  if (!data.metadata.source_checked || !/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.source_checked))
    fail('metadata.source_checked must be YYYY-MM-DD');
  if (!data.metadata.disclaimer || typeof data.metadata.disclaimer !== 'string')
    fail('metadata.disclaimer missing');
  if (!Array.isArray(data.categories) || data.categories.length === 0)
    fail('categories missing or empty');
  if (!Array.isArray(data.otherCategories))
    fail('otherCategories missing');

  const seenNocs = new Map();
  let total = 0;

  for (const cat of data.categories) {
    if (!cat.id || !cat.label) fail('category missing id or label');
    if (!Array.isArray(cat.occupations)) fail(`category ${cat.id} has no occupations[]`);
    if (cat.occupation_count !== cat.occupations.length)
      fail(`category ${cat.id}: occupation_count=${cat.occupation_count} but ${cat.occupations.length} entries`);

    const expected = EXPECTED_PER_CATEGORY[cat.id];
    if (expected !== undefined && cat.occupations.length !== expected)
      fail(`category ${cat.id}: expected ${expected} occupations, found ${cat.occupations.length}`);

    for (const occ of cat.occupations) {
      if (!occ.title || typeof occ.title !== 'string') fail(`category ${cat.id}: occupation missing title`);
      if (!/^\d{5}$/.test(String(occ.noc))) fail(`category ${cat.id} / ${occ.title}: NOC "${occ.noc}" is not 5 digits`);
      if (typeof occ.teer !== 'number' || occ.teer < 0 || occ.teer > 5)
        fail(`category ${cat.id} / ${occ.title}: TEER "${occ.teer}" out of range`);
      if (seenNocs.has(occ.noc))
        fail(`duplicate NOC ${occ.noc}: used in ${seenNocs.get(occ.noc)} and ${cat.id}`);
      seenNocs.set(occ.noc, cat.id);
      total++;
    }
  }

  if (total !== EXPECTED_TOTAL)
    fail(`expected ${EXPECTED_TOTAL} total occupations, found ${total}`);

  for (const oc of data.otherCategories) {
    if (!oc.id || !oc.label) fail('otherCategories entry missing id or label');
  }

  console.log('OK: occupations.json shape is valid.');
  console.log(`  ${total} occupations across ${data.categories.length} categories`);
  console.log(`  source_checked: ${data.metadata.source_checked}`);
};

main().catch(err => { console.error(err); process.exit(1); });
