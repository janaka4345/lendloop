## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.

### Branching & Pull requests

Create a branch off `main` (`feat/<ticket-slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`) before implementing any ticket or change, commit there, push the branch, and open a pull request targeting `main` (`main` is protected by branch ruleset).

Every PR body must follow the `/pr` skill (`.agents/skills/pr/SKILL.md`).
