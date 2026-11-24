## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Branching & Pull requests

Never commit or push directly to `main` (protected by branch ruleset). Before implementing any ticket or change, create a branch off `main` (e.g. `feat/<ticket-slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`), commit there, push the branch, and open a pull request targeting `main`.

Every PR body must follow the `/pr` skill (`.agents/skills/pr/SKILL.md`).
