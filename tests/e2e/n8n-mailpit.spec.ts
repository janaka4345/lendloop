import { expect, test } from "@playwright/test";
import { sha256Hex, signAutomationJwt } from "../../convex/automation/crypto";

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ?? "http://localhost:5678/webhook/lendloop-loan-notification";
const N8N_JWT_SECRET = process.env.N8N_JWT_SECRET ?? "ci-synthetic-n8n-jwt-secret-not-a-secret";
const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? "http://localhost:8025";

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string; Name: string }>;
  Snippet: string;
}

test.describe("Live n8n Workflow 1 -> Mailpit E2E", () => {
  test("delivers signed Loan notification into Mailpit, deduplicates repeated jti, and rejects invalid/tampered JWTs", async ({
    request,
  }) => {
    // 1. Clear Mailpit inbox before test
    await request.delete(`${MAILPIT_API_URL}/api/v1/messages`);

    const uniqueEventId = `loan_requested:e2e_${Date.now()}`;
    const recipientEmail = "lender.e2e@lendloop.local";
    const payload = {
      eventId: uniqueEventId,
      eventType: "loan_requested",
      loanId: "loan_e2e_1",
      listingName: "DeWalt 20V Cordless Drill",
      listingRemoved: false,
      recipientRole: "lender",
      recipientEmail,
      recipientName: "Alex Lender",
      counterpartyName: "Jordan Borrower",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      decisionReason: null,
      note: "Building a raised garden bed",
      appUrl: "http://localhost:3000",
    };

    const rawBody = JSON.stringify(payload);
    const bodySha256 = await sha256Hex(rawBody);
    const validJwt = await signAutomationJwt({
      secret: N8N_JWT_SECRET,
      jti: uniqueEventId,
      bodySha256,
    });

    // 2. Reject missing Authorization header (401/403)
    const missingAuthRes = await request.post(N8N_WEBHOOK_URL, {
      headers: { "Content-Type": "application/json" },
      data: rawBody,
    });
    expect([401, 403]).toContain(missingAuthRes.status());

    // 3. Reject JWT signed with wrong secret (401/403)
    const wrongSecretJwt = await signAutomationJwt({
      secret: "wrong-signing-secret-that-must-fail",
      jti: `${uniqueEventId}:wrong-secret`,
      bodySha256,
    });
    const invalidSigRes = await request.post(N8N_WEBHOOK_URL, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wrongSecretJwt}`,
      },
      data: rawBody,
    });
    expect([401, 403]).toContain(invalidSigRes.status());

    // 4. Reject valid JWT signature when payload body was tampered (bodySha256 mismatch -> 403)
    const tamperedBody = JSON.stringify({ ...payload, listingName: "Tampered Listing Name" });
    const tamperedRes = await request.post(N8N_WEBHOOK_URL, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validJwt}`,
      },
      data: tamperedBody,
    });
    expect([401, 403]).toContain(tamperedRes.status());

    // 5. Deliver valid signed request -> 200 smtp_accepted
    const validRes = await request.post(N8N_WEBHOOK_URL, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validJwt}`,
        "X-Idempotency-Key": uniqueEventId,
      },
      data: rawBody,
    });
    expect(validRes.status()).toBe(200);
    const validResJson = (await validRes.json()) as { status: string; eventId: string };
    expect(validResJson.status).toBe("smtp_accepted");
    expect(validResJson.eventId).toBe(uniqueEventId);

    // 6. Verify real email arrived in Mailpit HTTP API
    const mailpitRes = await request.get(`${MAILPIT_API_URL}/api/v1/messages`);
    expect(mailpitRes.status()).toBe(200);
    const mailpitData = (await mailpitRes.json()) as {
      total: number;
      messages: MailpitMessageSummary[];
    };
    expect(mailpitData.total).toBe(1);
    const delivered = mailpitData.messages[0]!;
    expect(delivered.Subject).toContain("DeWalt 20V Cordless Drill");
    expect(delivered.To.map((t) => t.Address)).toContain(recipientEmail);

    // 7. Re-send exact same jti -> 200 duplicate, still only 1 email in Mailpit
    const dupRes = await request.post(N8N_WEBHOOK_URL, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validJwt}`,
        "X-Idempotency-Key": uniqueEventId,
      },
      data: rawBody,
    });
    expect(dupRes.status()).toBe(200);
    const dupResJson = (await dupRes.json()) as { status: string };
    expect(dupResJson.status).toBe("duplicate");

    const mailpitAfterDup = (await (
      await request.get(`${MAILPIT_API_URL}/api/v1/messages`)
    ).json()) as { total: number };
    expect(mailpitAfterDup.total).toBe(1);
  });
});
