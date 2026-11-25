#!/usr/bin/env node
/**
 * Workflow JSON hygiene check for version-controlled n8n workflows under n8n/workflows/.
 * Fails if any workflow JSON contains:
 * - Missing required workflow files (01, 02, 03)
 * - Forbidden $env / $vars references (incompatible with n8n Cloud Starter)
 * - Hardcoded secrets, tokens, JWTs, or live cloud URLs
 * - Unsanitized credential IDs or errorWorkflow IDs (must equal "__REPLACE_ON_IMPORT__")
 * - Leaked top-level instance workflow IDs or versionIds
 */
import fs from "node:fs";
import path from "node:path";

const WORKFLOWS_DIR = path.resolve(process.cwd(), "n8n", "workflows");
const REQUIRED_PLACEHOLDER = "__REPLACE_ON_IMPORT__";
const REQUIRED_FILES = [
  "01-loan-notification.json",
  "02-overdue-reminders.json",
  "03-error-handler.json",
];

if (!fs.existsSync(WORKFLOWS_DIR)) {
  console.error("Workflow hygiene check failed: n8n/workflows directory is missing.");
  process.exit(1);
}

const files = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

const violations = [];

for (const required of REQUIRED_FILES) {
  if (!files.includes(required)) {
    violations.push(`missing required workflow file: ${required}`);
  }
}

const FORBIDDEN_PATTERNS = [
  { name: "forbidden $env reference", regex: /\$env\b/ },
  { name: "forbidden $vars reference", regex: /\$vars\b/ },
  { name: "live secret key", regex: /\b(?:sk_live_|pk_live_|whsec_|ghp_|gho_)[A-Za-z0-9_-]{8,}/ },
  {
    name: "hardcoded JWT",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: "leaked cloud URL",
    regex: /https?:\/\/[a-z0-9.-]+\.(?:convex\.site|convex\.cloud|awsapprunner\.com|n8n\.cloud)\b/i,
  },
];

for (const file of files) {
  const fullPath = path.join(WORKFLOWS_DIR, file);
  const raw = fs.readFileSync(fullPath, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    violations.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(raw)) {
      violations.push(`${file}: matched ${pattern.name}`);
    }
  }

  if (parsed.id !== undefined) {
    violations.push(`${file}: top-level workflow 'id' must be stripped before commit`);
  }
  if (parsed.versionId !== undefined) {
    violations.push(`${file}: top-level workflow 'versionId' must be stripped before commit`);
  }
  if (parsed.active === true) {
    violations.push(`${file}: exported workflow must have active: false`);
  }

  if (file !== "03-error-handler.json") {
    const errorWorkflow = parsed.settings?.errorWorkflow;
    if (errorWorkflow !== REQUIRED_PLACEHOLDER) {
      violations.push(
        `${file}: settings.errorWorkflow must be "${REQUIRED_PLACEHOLDER}" (got ${JSON.stringify(errorWorkflow)})`,
      );
    }
  }

  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  for (const node of nodes) {
    if (node.credentials && typeof node.credentials === "object") {
      for (const [credType, credRef] of Object.entries(node.credentials)) {
        if (!credRef || typeof credRef !== "object" || credRef.id !== REQUIRED_PLACEHOLDER) {
          violations.push(
            `${file}: node "${node.name}" credential "${credType}" id must be "${REQUIRED_PLACEHOLDER}"`,
          );
        }
      }
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
