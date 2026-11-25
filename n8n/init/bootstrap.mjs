#!/usr/bin/env node
/**
 * One-shot local/CI n8n bootstrapper.
 * Auto-imports local Mailpit SMTP, HS256 JWT, and Convex Service Token credentials,
 * rewrites "__REPLACE_ON_IMPORT__" placeholders in the 3 sanitized workflows,
 * imports them into n8n's SQLite DB, and activates Workflows 1 & 2 with zero manual setup.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SOURCE_WORKFLOWS_DIR = "/workflows";
const WORK_DIR = "/tmp/lendloop-n8n-import";
const WORKFLOWS_OUT_DIR = path.join(WORK_DIR, "workflows");

const CRED_IDS = {
  smtp: "lendloop-smtp-local",
  jwtAuth: "lendloop-jwt-local",
  httpHeaderAuth: "lendloop-header-local",
};

const WORKFLOW_META = {
  "01-loan-notification.json": { id: "lendloop-wf-01-notify", activate: true },
  "02-overdue-reminders.json": { id: "lendloop-wf-02-overdue", activate: true },
  "03-error-handler.json": { id: "lendloop-wf-03-error", activate: false },
};

const jwtSecret = (process.env.N8N_JWT_SECRET || "local-dev-n8n-jwt-secret-change-me").trim();
const serviceToken = (
  process.env.N8N_SERVICE_TOKEN || "local-dev-n8n-service-token-change-me"
).trim();
const smtpHost = (process.env.SMTP_HOST || "mailpit").trim();
const smtpPort = Number(process.env.SMTP_PORT || "1025");

fs.rmSync(WORK_DIR, { recursive: true, force: true });
fs.mkdirSync(WORKFLOWS_OUT_DIR, { recursive: true });

const credentials = [
  {
    id: CRED_IDS.smtp,
    name: "LendLoop SMTP",
    type: "smtp",
    data: {
      host: smtpHost,
      port: smtpPort,
      secure: false,
      user: "",
      password: "",
      disableStartTls: true,
    },
  },
  {
    id: CRED_IDS.jwtAuth,
    name: "LendLoop Convex JWT",
    type: "jwtAuth",
    data: {
      keyType: "passphrase",
      secret: jwtSecret,
      algorithm: "HS256",
    },
  },
  {
    id: CRED_IDS.httpHeaderAuth,
    name: "LendLoop Convex Service Token",
    type: "httpHeaderAuth",
    data: {
      name: "X-N8N-Service-Token",
      value: serviceToken,
    },
  },
];

const credentialsPath = path.join(WORK_DIR, "credentials.json");
fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), "utf8");

console.log("[n8n-init] Importing local credentials...");
execFileSync("n8n", ["import:credentials", `--input=${credentialsPath}`], {
  stdio: "inherit",
});

for (const [filename, meta] of Object.entries(WORKFLOW_META)) {
  const sourcePath = path.join(SOURCE_WORKFLOWS_DIR, filename);
  const workflow = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

  workflow.id = meta.id;
  workflow.active = meta.activate;

  if (workflow.settings?.errorWorkflow === "__REPLACE_ON_IMPORT__") {
    workflow.settings.errorWorkflow = WORKFLOW_META["03-error-handler.json"].id;
  }

  for (const node of workflow.nodes ?? []) {
    if (!node.credentials) continue;
    for (const [credType, credRef] of Object.entries(node.credentials)) {
      if (credRef && credRef.id === "__REPLACE_ON_IMPORT__" && CRED_IDS[credType]) {
        credRef.id = CRED_IDS[credType];
      }
    }
  }

  const outPath = path.join(WORKFLOWS_OUT_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2), "utf8");
}

console.log("[n8n-init] Importing sanitized workflows...");
execFileSync("n8n", ["import:workflow", "--separate", `--input=${WORKFLOWS_OUT_DIR}`], {
  stdio: "inherit",
});

for (const [filename, meta] of Object.entries(WORKFLOW_META)) {
  if (!meta.activate) continue;
  console.log(`[n8n-init] Activating ${filename} (${meta.id})...`);
  execFileSync("n8n", ["update:workflow", `--id=${meta.id}`, "--active=true"], {
    stdio: "inherit",
  });
}

console.log("[n8n-init] Bootstrap complete.");
