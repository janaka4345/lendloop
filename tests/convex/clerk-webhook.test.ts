import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createTestBackend } from "./test-helpers";

const TEST_WEBHOOK_SECRET = "whsec_Y2lfc3ludGhldGljX25vbl9zZWNyZXRfcGxhY2Vob2xkZXI=";
const ORIGINAL_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

function signClerkPayload(payload: object, secret: string = TEST_WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const msgId = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  const webhook = new Webhook(secret);
  const signature = webhook.sign(msgId, timestamp, body);
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  };
}

beforeEach(() => {
  process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});

afterEach(() => {
  if (ORIGINAL_WEBHOOK_SECRET === undefined) {
    delete process.env.CLERK_WEBHOOK_SECRET;
  } else {
    process.env.CLERK_WEBHOOK_SECRET = ORIGINAL_WEBHOOK_SECRET;
  }
});

describe("Svix-verified Clerk webhook (user.updated and user.deleted cascade)", () => {
  it("rejects missing Svix headers with 400 and invalid signatures with 401", async () => {
    const t = createTestBackend();

    const missingHeadersRes = await t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user.updated", data: { id: "user_1" } }),
    });
    expect(missingHeadersRes.status).toBe(400);

    const signed = signClerkPayload({ type: "user.updated", data: { id: "user_1" } });
    const tamperedRes = await t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify({ type: "user.deleted", data: { id: "user_1" } }),
    });
    expect(tamperedRes.status).toBe(401);
  });

  it("handles user.updated by updating displayName/email without altering role or trustedLender", async () => {
    const t = createTestBackend();
    const asAlice = t.withIdentity({
      subject: "user_clerk_alice",
      email: "alice@example.com",
      name: "Alice Old",
    });
    const alice = await asAlice.mutation(api.users.mutations.syncCurrentUser, {});

    await t.run(async (ctx) => {
      await ctx.db.patch(alice._id, { role: "admin", trustedLender: true });
    });

    const signed = signClerkPayload({
      type: "user.updated",
      data: {
        id: "user_clerk_alice",
        first_name: "Alice",
        last_name: "Newname",
        primary_email_address_id: "email_primary",
        email_addresses: [
          { id: "email_old", email_address: "old@example.com" },
          { id: "email_primary", email_address: "alice.updated@example.com" },
        ],
      },
    });

    const res = await t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    expect(res.status).toBe(200);

    const updated = await t.run((ctx) => ctx.db.get(alice._id));
    expect(updated).toMatchObject({
      displayName: "Alice Newname",
      email: "alice.updated@example.com",
      role: "admin",
      trustedLender: true,
    });
  });

  it("handles user.deleted with full anonymization, listing archival, photo/upload cleanup, pending loan cascade, and non-PII Audit Log", async () => {
    const t = createTestBackend();

    const asTarget = t.withIdentity({
      subject: "user_to_delete",
      email: "delete.me@example.com",
      name: "Target User",
    });
    const asOther = t.withIdentity({
      subject: "user_counterparty",
      email: "neighbor@example.com",
      name: "Counterparty",
    });

    const target = await asTarget.mutation(api.users.mutations.syncCurrentUser, {});
    const other = await asOther.mutation(api.users.mutations.syncCurrentUser, {});

    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(target._id, { trustedLender: true });

      const listingPhotoId = await ctx.storage.store(
        new Blob(["photo-bytes"], { type: "image/webp" }),
      );
      const pendingUploadBlobId = await ctx.storage.store(
        new Blob(["pending-bytes"], { type: "image/webp" }),
      );

      const targetListingId = await ctx.db.insert("listings", {
        lenderId: target._id,
        name: "Pressure Washer",
        category: "cleaning",
        condition: "good",
        description: "Electric pressure washer",
        imageIds: [listingPhotoId],
        createdAt: now,
        updatedAt: now,
      });

      const otherListingId = await ctx.db.insert("listings", {
        lenderId: other._id,
        name: "Camping Tent",
        category: "camping",
        condition: "like_new",
        description: "4-person tent",
        createdAt: now,
        updatedAt: now,
      });

      const pendingUploadId = await ctx.db.insert("listingImageUploads", {
        storageId: pendingUploadBlobId,
        uploaderId: target._id,
        status: "pending",
        contentType: "image/webp",
        sizeBytes: 123,
        width: 800,
        height: 600,
        createdAt: now,
      });

      // Pending Borrower Loan -> should be auto-cancelled
      const pendingBorrowerLoanId = await ctx.db.insert("loans", {
        listingId: otherListingId,
        lenderId: other._id,
        borrowerId: target._id,
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      // Pending Lender Loan -> should be auto-declined
      const pendingLenderLoanId = await ctx.db.insert("loans", {
        listingId: targetListingId,
        lenderId: target._id,
        borrowerId: other._id,
        startDate: "2026-07-05",
        endDate: "2026-07-07",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      // Approved Loan -> MUST be preserved
      const approvedLoanId = await ctx.db.insert("loans", {
        listingId: targetListingId,
        lenderId: target._id,
        borrowerId: other._id,
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      });

      // Historical Returned Loan -> MUST be preserved
      const returnedLoanId = await ctx.db.insert("loans", {
        listingId: otherListingId,
        lenderId: other._id,
        borrowerId: target._id,
        startDate: "2026-04-01",
        endDate: "2026-04-02",
        status: "returned",
        returnedAt: now - 1000,
        createdAt: now - 2000,
        updatedAt: now - 1000,
      });

      return {
        listingPhotoId,
        pendingUploadBlobId,
        targetListingId,
        pendingUploadId,
        pendingBorrowerLoanId,
        pendingLenderLoanId,
        approvedLoanId,
        returnedLoanId,
      };
    });

    const signed = signClerkPayload({
      type: "user.deleted",
      data: { id: "user_to_delete" },
    });

    const res = await t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    expect(res.status).toBe(200);

    await t.run(async (ctx) => {
      // 1. User tombstone anonymized
      const tombstoned = await ctx.db.get(target._id);
      expect(tombstoned).toMatchObject({
        externalId: `deleted:${target._id}`,
        email: "",
        displayName: "Deleted User",
        trustedLender: false,
      });
      expect(tombstoned?.deletedAt).toBeTypeOf("number");

      // 2. Listing archived and photo deleted from storage
      const archivedListing = await ctx.db.get(seeded.targetListingId);
      expect(archivedListing?.archivedAt).toBeTypeOf("number");
      expect(archivedListing?.archiveReason).toBe("User deleted");
      expect(archivedListing?.imageIds).toEqual([]);
      expect(await ctx.storage.get(seeded.listingPhotoId)).toBeNull();

      // 3. Pending upload deleted from table and storage
      expect(await ctx.db.get(seeded.pendingUploadId)).toBeNull();
      expect(await ctx.storage.get(seeded.pendingUploadBlobId)).toBeNull();

      // 4. Pending loans transitioned; approved & historical loans preserved
      const borrowerLoan = await ctx.db.get(seeded.pendingBorrowerLoanId);
      expect(borrowerLoan?.status).toBe("cancelled");
      expect(borrowerLoan?.decisionReason).toBe("Borrower User deleted");

      const lenderLoan = await ctx.db.get(seeded.pendingLenderLoanId);
      expect(lenderLoan?.status).toBe("declined");
      expect(lenderLoan?.decisionReason).toBe("Lender User deleted");

      const approvedLoan = await ctx.db.get(seeded.approvedLoanId);
      expect(approvedLoan?.status).toBe("approved");

      const returnedLoan = await ctx.db.get(seeded.returnedLoanId);
      expect(returnedLoan?.status).toBe("returned");

      // 5. Non-PII Audit Log recorded
      const logs = await ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", target._id))
        .take(10);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorRole: "system",
        action: "user.deleted",
        targetType: "user",
        targetId: target._id,
        metadata: {
          archivedListings: 1,
          deletedUploads: 1,
          cancelledLoans: 1,
          declinedLoans: 1,
        },
      });
      expect(JSON.stringify(logs[0])).not.toContain("delete.me@example.com");
      expect(JSON.stringify(logs[0])).not.toContain("Target User");
      expect(JSON.stringify(logs[0])).not.toContain("user_to_delete");
    });
  });
});
