# scripts

Node.js utilities used by CI.

- `check-occupations-shape.mjs` — validates data/occupations.json structure
- `check-occupations-drift.mjs` — compares JSON against index.html inline copy

Run locally:
    node scripts/check-occupations-shape.mjs
    node scripts/check-occupations-drift.mjs
