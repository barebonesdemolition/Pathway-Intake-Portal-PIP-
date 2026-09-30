# Pathway Intake Portal (PIP)

The objective of this project is to deploy an internal, mobile-friendly intake and case management system for agency staff and frontline sourcing agents. The platform handles candidate data intake, document uploads (passports, bank statements, CVs, business plans), payment receipt tracking, and automated Google Drive document organization.

---

## What it does

- **Mobile-first intake form** (`index.html`) that runs from a phone browser, in the field, on unreliable connections.
- **Passport scan** via Mindee OCR — fills name, DOB, passport number, expiry, nationality. The agent must confirm each field before submitting.
- **NOC-aware occupation picker** driven by `data/occupations.json` (the Sierra Leone Express Entry Occupation Guide). Records the NOC code and TEER alongside the candidate's actual stated job title and employer.
- **Automatic Drive organization** — each submission gets its own folder (`CA-YYMMDD-NNNN`) with subfolders for Identity, Financial, CV and Profile, Payment Receipts, Business, and Education and Experience.
- **Master Ledger** row in the bound Google Sheet, with a Status dropdown, per-submission timestamp, and folder link.
- **Team email alert** on every submission (no passport numbers or financial amounts in the body).
- **30-second throttle** per access code to prevent accidental double-submissions.

## What it deliberately does not do

- Does **not** assess eligibility.
- Does **not** tell a candidate they qualify or that they match a NOC.
- Does **not** replace the licensed Canadian representative's review.

The form records facts. The RCIC confirms NOC and Express Entry eligibility.

---

## Repository structure
