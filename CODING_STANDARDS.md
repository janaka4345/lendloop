# Coding Standards

Judgement-call standards enforced during `/code-review`. Mechanical rules (formatting, TypeScript strictness, pure-domain / cross-slice import boundaries, `NEXT_PUBLIC_*` ban, workflow JSON hygiene) are enforced by `pnpm check` and CI rather than restated here.

## Ubiquitous Language

- Match `GLOSSARY.md` across UI copy, DTOs, error messages, and test names (`User`, `Lender`, `Borrower`, `Admin`, `Trusted Lender`, `Listing`, `Loan`, `Category`, `Condition`, `Availability`, `Overdue`, `Automation Activity`, `Audit Log`).

## Security & Secret Hygiene

- Keep `.gitleaks.toml` allowlists scoped to exact synthetic placeholder literals — never blanket file-path globs that could mask real secrets added later.
- Never return raw secret values or unfiltered internal errors in HTTP responses, readiness checks, logs, or non-`Admin` DTOs.
- Parse multi-hop proxy headers (such as `x-forwarded-proto`) by taking the trimmed first comma-separated entry rather than matching the raw string.

## Container & CI Hygiene

- Keep `Dockerfile` free of `# syntax=` external BuildKit frontend directives unless a BuildKit-only feature is genuinely needed.
- Keep the container `runner` stage minimal: run `apk upgrade --no-cache`, strip unused runtime package managers (`npm`, `corepack`, `yarn`), and run as non-root `USER 10001`.
- Build once in CI, scan that exact image with Grype (`output-format: "table"` so findings appear in logs), and boot the same image via `--no-build` in Compose E2E.
- Pin every GitHub Action to a full 40-character commit SHA with a version comment, keep workflow default permissions at `contents: read`, and grant extra read permissions only on the specific job that requires them.
