# scripts

Small Node.js utilities used by CI and by humans.

## `check-occupations-drift.mjs`

Compares the occupation data in `data/occupations.json` against the
`OCCUPATION_GUIDE` object embedded in `index.html`. Fails the build if they
disagree.

**Why:** the data is duplicated (JSON for tooling, inline for offline-safe
form delivery). Duplication is fine as long as drift is impossible to merge.

**To fix a failure:**
1. Edit `data/occupations.json` — that is the source of truth.
2. Copy the JSON body verbatim into `index.html` between the markers:
