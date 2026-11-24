import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_PATTERNS = [
  /<diagram,\s*diff-sketch,\s*or tree>/i,
  /<screenshot\/output\/failing test run>/i,
  /<screenshot\/output\/passing test run>/i,
  /<one-way or two-way>/i,
  /<one-word description>/i,
];

/**
 * Extract the content under a level-2 markdown heading (`## Heading`).
 * Returns null if the heading is not found.
 */
function getSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`^##\\s+${escaped}\\s*$`, "im");
  const match = headerRe.exec(body);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeader = /^##\s+/m.exec(rest);
  const content = nextHeader ? rest.slice(0, nextHeader.index) : rest;
  return content.trim();
}

/**
 * Validate a PR body against the `/pr` skill (`.agents/skills/pr/SKILL.md`).
 * @param {string} rawBody
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePrBody(rawBody) {
  const body = (rawBody ?? "").replace(/\r\n/g, "\n").trim();
  const errors = [];

  if (!body) {
    return {
      valid: false,
      errors: ["PR body is empty. Follow the `/pr` skill (.agents/skills/pr/SKILL.md)."],
    };
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(body)) {
      errors.push(`Unfilled template placeholder found matching ${pattern}`);
    }
  }

  // 1. ## Summary
  const summary = getSection(body, "Summary");
  if (summary === null) {
    errors.push("Missing required `## Summary` section.");
  } else if (!summary) {
    errors.push("`## Summary` section is empty.");
  }

  // 2. ## Evidence
  const evidence = getSection(body, "Evidence");
  if (evidence === null) {
    errors.push("Missing required `## Evidence` section.");
  } else {
    if (!/\bBefore:\s*\**/i.test(evidence) && !/\*\*Before:\*\*/i.test(evidence)) {
      errors.push("`## Evidence` must include a `Before:` entry.");
    }
    if (!/\bAfter:\s*\**/i.test(evidence) && !/\*\*After:\*\*/i.test(evidence)) {
      errors.push("`## Evidence` must include an `After:` entry.");
    }
  }

  // 3. ## Merge Danger
  const mergeDanger = getSection(body, "Merge Danger");
  if (mergeDanger === null) {
    errors.push("Missing required `## Merge Danger` section.");
  } else {
    if (!/\*{0,2}Door:\*{0,2}\s*(?:one-way|two-way)\b/i.test(mergeDanger)) {
      errors.push("`## Merge Danger` must specify `**Door:** one-way` or `**Door:** two-way`.");
    }
    const blastMatch = /\*{0,2}Blast Radius:\*{0,2}[ \t]*([^\n]*)/i.exec(mergeDanger);
    if (!blastMatch || !blastMatch[1].trim()) {
      errors.push("`## Merge Danger` must specify a non-empty `**Blast Radius:**`.");
    }
  }

  return { valid: errors.length === 0, errors };
}

// CLI entrypoint (used by GitHub Actions or local checks)
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);

if (isDirectRun) {
  let body = process.env.PR_BODY;
  if (body === undefined) {
    const fileArg = process.argv[2];
    body = fileArg ? fs.readFileSync(fileArg, "utf8") : fs.readFileSync(0, "utf8");
  }

  const result = validatePrBody(body);
  if (!result.valid) {
    console.error("PR body does not follow the `/pr` skill (.agents/skills/pr/SKILL.md):");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("PR body matches the `/pr` skill.");
}
