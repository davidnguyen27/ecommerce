## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Working with the app

- Choosing an external service (payment gateway, carrier, email/SMS provider): read `docs/agents/third-party.md` before writing the ADR.
- Driving the real app locally (orders, admin login, payments, Docker): see `docs/agents/local-walkthrough.md`.
- Deploying or operating the online demo (Netlify, Render, Neon, R2): see `docs/deploy.md` and ADR 0011.
