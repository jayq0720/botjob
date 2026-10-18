---
name: job-hunt
description: >-
  End-to-end job hunt: save resume, analyze profile, search 智联/猎聘/51job,
  queue applications with user approval.
---

# Job hunt

## When to use

User wants to upload a resume, find roles, or apply on Chinese job boards.

## Steps

1. `save_resume` with plain `text`, or PDF via `pdfBase64` / `workspacePath` (`.pdf`).
2. Analyze extracted text, then `save_resume_profile` (target titles, skills, cities, keywords).
3. `search_jobs` — share `searchPacks[].searchUrl` for 智联 / 猎聘 / 51job.
4. User picks roles → `queue_apply` (approval required).
5. `export_apply_pack` → give `localCommand` for本机半自动投递.
6. After local runner finishes, `mark_applied` with results; `list_applications` for status.

## Local runner

```bash
npx playwright install chromium
npm run apply:local -- --pack apply-packs/pack-….json
# dry-run without browser:
npm run apply:local -- --pack fixtures/sample-apply-pack.json --dry-run
```

## Do not

- Claim cloud-side silent auto-submit succeeded.
- Ask for job-board passwords.
- Search before a profile exists.
