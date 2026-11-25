import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex, signAutomationJwt } from "../../convex/automation/crypto";

const WORKFLOWS_DIR = path.resolve(process.cwd(), "n8n", "workflows");

interface WorkflowNode {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
  retryOnFail?: boolean;
  maxTries?: number;
  onError?: string;
}

interface WorkflowJson {
  name: string;
  active: boolean;
  settings?: Record<string, unknown>;
  nodes: WorkflowNode[];
}

function loadWorkflow(filename: string): WorkflowJson {
  return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, filename), "utf8")) as WorkflowJson;
}

describe("Sanitized n8n workflows contract & inline verification scripts", () => {
  it("Workflow 1 inline Code node verifies JWT claims & rawBody SHA-256 and rejects tampered bodies", async () => {
    const wf = loadWorkflow("01-loan-notification.json");
    const verifyNode = wf.nodes.find((n) => n.name === "Verify Claims & Body Hash");
    expect(verifyNode).toBeDefined();
    const jsCode = String(verifyNode?.parameters?.jsCode ?? "");

    const payload = {
      eventId: "loan_requested:123",
      eventType: "loan_requested",
      loanId: "123",
      listingName: "Bosch Sander",
      recipientRole: "lender",
      recipientEmail: "lender@example.com",
      recipientName: "Sam",
      counterpartyName: "Pat",
      startDate: "2026-06-20",
      endDate: "2026-06-22",
      appUrl: "http://localhost:3000",
    };
    const rawBody = JSON.stringify(payload);
    const bodySha256 = await sha256Hex(rawBody);
    const jwt = await signAutomationJwt({
      secret: "unit-test-secret",
      jti: payload.eventId,
      bodySha256,
    });

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<Array<{ json: Record<string, unknown> }>>;
    const runner = new AsyncFunction("$", "$input", jsCode);

    const runWith = (authHeader: string, bodyBytes: Buffer) => {
      const webhookItem = {
        json: { headers: { authorization: authHeader }, body: payload },
        binary: { data: { data: bodyBytes.toString("base64") } },
      };
      const configItem = {
        json: {
          fromEmail: "noreply@lendloop.local",
          appName: "LendLoop",
          expectedIss: "convex",
          expectedAud: "n8n-automation",
        },
      };
      return runner(() => ({ first: () => webhookItem }), { first: () => configItem });
    };

    const okResult = await runWith(`Bearer ${jwt}`, Buffer.from(rawBody, "utf8"));
    expect(okResult[0]?.json.valid).toBe(true);
    expect(okResult[0]?.json.jti).toBe("loan_requested:123");
    expect(okResult[0]?.json.subject).toContain("Bosch Sander");

    const tamperedResult = await runWith(
      `Bearer ${jwt}`,
      Buffer.from(JSON.stringify({ ...payload, listingName: "Tampered" }), "utf8"),
    );
    expect(tamperedResult[0]?.json).toEqual({ valid: false, errorCode: "BODY_HASH_MISMATCH" });
  });

  it("Workflow 3 Error Handler strips Borrower/Lender PII, emails, JWTs, and Bearer tokens", async () => {
    const wf = loadWorkflow("03-error-handler.json");
    const sanitizeNode = wf.nodes.find((n) => n.name === "Sanitize Ops Alert");
    expect(sanitizeNode).toBeDefined();
    const jsCode = String(sanitizeNode?.parameters?.jsCode ?? "");

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<Array<{ json: Record<string, unknown> }>>;
    const runner = new AsyncFunction("$", "$input", jsCode);

    const triggerItem = {
      json: {
        workflow: { id: "wf_1", name: "LendLoop — 01 Loan Notification" },
        execution: {
          id: "exec_99",
          lastNodeExecuted: "Send Notification Email",
          error: {
            name: "NodeOperationError",
            message:
              "SMTP failed for borrower@example.com with Bearer superSecretToken999 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig_value_here",
          },
        },
      },
    };
    const configItem = {
      json: {
        opsAlertEmail: "ops@lendloop.local",
        fromEmail: "alerts@lendloop.local",
      },
    };

    const result = await runner(() => ({ first: () => triggerItem }), { first: () => configItem });
    const text = String(result[0]?.json.text ?? "");
    expect(text).toContain("LendLoop — 01 Loan Notification");
    expect(text).toContain("exec_99");
    expect(text).not.toContain("borrower@example.com");
    expect(text).not.toContain("superSecretToken999");
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).toContain("[REDACTED]");
  });
});
