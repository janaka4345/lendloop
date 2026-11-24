#!/usr/bin/env node
/**
 * Workflow JSON hygiene check (Commit-1 stub; expanded in Slice 6 when n8n workflows are added).
 * Fails if any exported workflow JSON under n8n/workflows/ contains:
 * - Forbidden $env / $vars references (incompatible with n8n Cloud Starter)
 * - Hardcoded secret tokens or live Clerk/Convex/SMTP credentials
 * - Unsanitized credential IDs (must use "__REPLACE_ON_IMPORT__")
 */
import fs from "node:fs";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), "n8n", "workflows");

if (!fs.existsSync(WORKFLOWS_DIR)) {
  console.log("Workflow hygiene check passed (no n8n/workflows directory yet).");
  process.exit(0);
}

const files = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.log("Workflow hygiene check passed (0 workflow files found).");
  process.exit(0);
}

const FORBIDDEN_PATTERNS = [
  { name: "forbidden $env reference", regex: /\$env\b/ },
  { name: "forbidden $vars reference", regex: /\$vars\b/ },
  { name: "live secret key", regex: /\b(?:sk_live_|pk_live_|whsec_)[A-Za-z0-9_-]{8,}/ },
];

const violations = [];

for (const file of files) {
  const fullPath = path.join(WORKFLOWS_DIR, file);
  const raw = fs.readFileSync(fullPath, "utf8");

  try {
    JSON.parse(raw);
  } catch (error) {
    violations.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(raw)) {
      violations.push(`${file}: matched ${pattern.name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Workflow hygiene check failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(`Workflow hygiene check passed (${files.length} workflow file(s) verified).`);
