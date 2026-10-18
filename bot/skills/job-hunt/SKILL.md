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
5. After approval, give apply URLs; user finishes login + submit in browser.
6. `list_applications` for status.

## Do not

- Claim silent auto-submit succeeded.
- Ask for job-board passwords.
- Search before a profile exists.
