# Q&A Notes local repository guidance

## Scope and entry points

- This repository is the distributable Windows local edition of Q&A Notes. `README.md` is the setup guide, `Start_QA_Notes.cmd` starts `server.cjs`, and `QA_Notes.html` supports offline preset-answer lookup.
- `presentation.json` contains the HAI 2026 sample, prepared answers, and recovery phrases. Preserve the paper attribution and source references when editing it.
- The runtime requires Node.js 22 or later. The browser interface targets current Chrome and Edge.

## User data and credentials

- `.env.local`, `budget-config.local.json`, `user-presentation.json`, and `usage-ledger.json` belong to each user. Keep them out of version control and distributable artifacts.
- Keep the budget disabled by default. Review changes to API calls, source import, audio recording, and budget accounting before distribution.
- Preserve bundled third-party license files when updating vendored libraries.

## Validation

- Run `node --check server.cjs`, `node --check budget.cjs`, and `node --check presentation.cjs` after server or budget changes.
- For interface changes, open the local server and verify preset answer lookup, user-material import, and the API-disabled state before publication.
