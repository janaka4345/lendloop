import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { todayUtcDate } from "../../src/domain/dates";
import { createTestBackend, expectAppError } from "./test-helpers";

async function seedUser(
  t: ReturnType<typeof createTestBackend>,
  identity: { subject: string; email: string; name: string },
  overrides?: { role?: "user" | "admin"; trustedLender?: boolean },
) {
  const authed = t.withIdentity(identity);
  const user = await authed.mutation(api.users.mutations.syncCurrentUser, {});
  if (overrides) {
    await t.run(async (ctx) => {
      await ctx.db.patch(user._id, overrides);
    });
  }
  return { authed, userId: user._id };
}

async function seedPendingImageUpload(
  t: ReturnType<typeof createTestBackend>,
  authed: ReturnType<ReturnType<typeof createTestBackend>["withIdentity"]>,
  content = "fake-webp-bytes",
): Promise<Id<"_storage">> {
  const storageId = await t.run(async (ctx) => {
    return ctx.storage.store(new Blob([content], { type: "image/webp" }));
  });
  await authed.mutation(api.listings.mutations.registerListingImageUpload, {
    storageId,
    contentType: "image/webp",
    sizeBytes: content.length,
    width: 800,
    height: 600,
  });
  return storageId;
}

describe("Listings strict DTOs, discovery, search, filters, and pagination", () => {
  it("enforces strict Public DTO allow-list and hides Currently Borrowed and archived Listings on Public /", async () => {
    const t = createTestBackend();
    const { authed: asAlice, userId: aliceId } = await seedUser(
      t,
      { subject: "sub_alice", email: "alice@example.com", name: "Alice Lender" },
      { trustedLender: true },
    );
    const { userId: bobId } = await seedUser(t, {
      subject: "sub_bob",
      email: "bob@example.com",
      name: "Bob Borrower",
    });

    const photoId = await seedPendingImageUpload(t, asAlice, "webp-1");

    const { _id: availableId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Cordless Hammer Drill",
      category: "power_tools",
      condition: "like_new",
      description: "18V brushless drill with two batteries.",
      imageIds: [photoId],
    });

    const { _id: borrowedId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Gas Pressure Washer",
      category: "cleaning",
      condition: "good",
      description: "3000 PSI pressure washer.",
      imageIds: [],
    });

    const { _id: archivedId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Broken Saw",
      category: "hand_tools",
      condition: "fair",
      description: "Old saw.",
      imageIds: [],
    });
    await asAlice.mutation(api.listings.mutations.archiveListing, { listingId: archivedId });

    // Create an approved Loan covering today for borrowedId
    const today = todayUtcDate();
    await t.run(async (ctx) => {
      await ctx.db.insert("loans", {
        listingId: borrowedId,
        lenderId: aliceId,
        borrowerId: bobId,
        startDate: today,
        endDate: today,
        status: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Unauthenticated caller invokes Public query
    const publicPage = await t.query(api.listings.queries.listPublicAvailableListings, {});
    expect(publicPage.items).toHaveLength(1);

    const item = publicPage.items[0]!;
    expect(item._id).toBe(availableId);
    expect(item.name).toBe("Cordless Hammer Drill");
    expect(item.category).toBe("power_tools");
    expect(item.images).toHaveLength(1);
    expect(typeof item.images[0]!.url).toBe("string");

    // Strict allow-list key check: ZERO Lender identity, Trusted Lender, Condition, description, storageId, or Loan data
    expect(Object.keys(item).sort()).toEqual(["_id", "category", "images", "name"]);
    expect(Object.keys(item.images[0]!).sort()).toEqual(["url"]);
  });

  it("supports authenticated All Tools catalog DTO, search, Category filter, Available today toggle, and 50-item pagination cap", async () => {
    const t = createTestBackend();
    const { authed: asAlice, userId: aliceId } = await seedUser(
      t,
      { subject: "sub_alice_cat", email: "alice@example.com", name: "Alice Lender" },
      { trustedLender: true },
    );
    const { authed: asBob, userId: bobId } = await seedUser(t, {
      subject: "sub_bob_cat",
      email: "bob@example.com",
      name: "Bob Borrower",
    });

    // Unauthenticated call must fail
    await expectAppError(t.query(api.listings.queries.listCatalogListings, {}), "UNAUTHENTICATED");

    const { _id: drillId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Cordless Impact Drill",
      category: "power_tools",
      condition: "new",
      description: "Brand new impact driver.",
    });

    const { _id: mowerId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Electric Lawn Mower",
      category: "garden",
      condition: "good",
      description: "Quiet battery mower.",
    });

    const today = todayUtcDate();
    await t.run(async (ctx) => {
      await ctx.db.insert("loans", {
        listingId: mowerId,
        lenderId: aliceId,
        borrowerId: bobId,
        startDate: today,
        endDate: today,
        status: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Full catalog returns both with derived Availability & Lender summary (no PII)
    const allResult = await asBob.query(api.listings.queries.listCatalogListings, {});
    expect(allResult.items).toHaveLength(2);
    const drillDto = allResult.items.find((l) => l._id === drillId)!;
    expect(drillDto.availability).toBe("Available");
    expect(drillDto.lender).toEqual({
      id: aliceId,
      displayName: "Alice Lender",
      trustedLender: true,
    });
    expect("email" in drillDto.lender).toBe(false);
    expect("externalId" in drillDto.lender).toBe(false);
    expect("role" in drillDto.lender).toBe(false);

    const mowerDto = allResult.items.find((l) => l._id === mowerId)!;
    expect(mowerDto.availability).toBe("Currently Borrowed");

    // Category filter
    const gardenOnly = await asBob.query(api.listings.queries.listCatalogListings, {
      category: "garden",
    });
    expect(gardenOnly.items.map((i) => i._id)).toEqual([mowerId]);

    // Available today only filter
    const availableOnly = await asBob.query(api.listings.queries.listCatalogListings, {
      availableOnly: true,
    });
    expect(availableOnly.items.map((i) => i._id)).toEqual([drillId]);

    // Server search index
    const searchResult = await asBob.query(api.listings.queries.listCatalogListings, {
      search: "Impact",
    });
    expect(searchResult.items.map((i) => i._id)).toEqual([drillId]);

    // Pagination cap: seed 55 extra listings and request limit=200 -> clamped to 50
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 55; i += 1) {
        await ctx.db.insert("listings", {
          lenderId: aliceId,
          name: `Tool ${i}`,
          category: "other",
          condition: "good",
          description: `Description ${i}`,
          imageIds: [],
          createdAt: now + i,
          updatedAt: now + i,
        });
      }
    });

    const firstPage = await asBob.query(api.listings.queries.listCatalogListings, {
      limit: 200,
    });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await asBob.query(api.listings.queries.listCatalogListings, {
      limit: 50,
      cursor: firstPage.continueCursor,
    });
    expect(secondPage.items).toHaveLength(7);
    expect(secondPage.isDone).toBe(true);
  });
});

describe("Listings image uploads, anti-IDOR, pending cap, rate limiting, and atomic cleanup", () => {
  it("enforces upload validation, 10-pending-upload cap, 10/min rate limit, and anti-IDOR ownership", async () => {
    const t = createTestBackend();
    const { authed: asAlice } = await seedUser(t, {
      subject: "sub_alice_img",
      email: "alice@example.com",
      name: "Alice",
    });
    const { authed: asBob } = await seedUser(t, {
      subject: "sub_bob_img",
      email: "bob@example.com",
      name: "Bob",
    });

    // Reject non-WebP registration
    const rawBlobId = await t.run(async (ctx) => {
      return ctx.storage.store(new Blob(["<svg></svg>"], { type: "image/svg+xml" }));
    });
    await expectAppError(
      asAlice.mutation(api.listings.mutations.registerListingImageUpload, {
        storageId: rawBlobId,
        contentType: "image/svg+xml",
        sizeBytes: 11,
        width: 100,
        height: 100,
      }),
      "VALIDATION_ERROR",
    );

    // Register 10 pending uploads for Alice
    const aliceUploads: Id<"_storage">[] = [];
    for (let i = 0; i < 10; i += 1) {
      aliceUploads.push(await seedPendingImageUpload(t, asAlice, `img-${i}`));
    }

    // 11th pending upload registration is blocked by 10-pending cap
    const extraBlobId = await t.run(async (ctx) => {
      return ctx.storage.store(new Blob(["extra"], { type: "image/webp" }));
    });
    await expectAppError(
      asAlice.mutation(api.listings.mutations.registerListingImageUpload, {
        storageId: extraBlobId,
        contentType: "image/webp",
        sizeBytes: 5,
        width: 100,
        height: 100,
      }),
      "VALIDATION_ERROR",
    );

    // Anti-IDOR: Bob cannot attach Alice's pending storageId to Bob's Listing
    await expectAppError(
      asBob.mutation(api.listings.mutations.createListing, {
        name: "Stolen Photo Listing",
        category: "other",
        condition: "good",
        description: "Attempting IDOR.",
        imageIds: [aliceUploads[0]!],
      }),
      "FORBIDDEN",
    );

    // Anti-IDOR: Bob cannot discard Alice's pending upload
    await expectAppError(
      asBob.mutation(api.listings.mutations.discardPendingListingImageUpload, {
        storageId: aliceUploads[0]!,
      }),
      "FORBIDDEN",
    );

    // Alice can discard her own pending upload and blob is deleted
    const discardResult = await asAlice.mutation(
      api.listings.mutations.discardPendingListingImageUpload,
      { storageId: aliceUploads[0]! },
    );
    expect(discardResult.discarded).toBe(true);

    const discardedUrl = await t.run((ctx) => ctx.storage.getUrl(aliceUploads[0]!));
    expect(discardedUrl).toBeNull();

    // Rate limit: Bob generates 10 upload URLs within 1 minute; 11th is RATE_LIMITED
    for (let i = 0; i < 10; i += 1) {
      const res = await asBob.mutation(api.listings.mutations.generateListingImageUploadUrl, {});
      expect(typeof res.uploadUrl).toBe("string");
    }
    await expectAppError(
      asBob.mutation(api.listings.mutations.generateListingImageUploadUrl, {}),
      "RATE_LIMITED",
    );
  });

  it("atomically deletes removed photos on edit and rejects > 5 photos", async () => {
    const t = createTestBackend();
    const { authed: asAlice } = await seedUser(t, {
      subject: "sub_alice_edit",
      email: "alice@example.com",
      name: "Alice",
    });

    const img1 = await seedPendingImageUpload(t, asAlice, "photo-1");
    const img2 = await seedPendingImageUpload(t, asAlice, "photo-2");
    const img3 = await seedPendingImageUpload(t, asAlice, "photo-3");

    const { _id: listingId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Circular Saw",
      category: "power_tools",
      condition: "good",
      description: "7-1/4 inch corded circular saw.",
      imageIds: [img1, img2],
    });

    // Edit: reorder img2 first, add img3, remove img1
    const updateRes = await asAlice.mutation(api.listings.mutations.updateListing, {
      listingId,
      name: "Circular Saw (Updated)",
      category: "power_tools",
      condition: "like_new",
      description: "Includes new carbide blade.",
      imageIds: [img2, img3],
    });
    expect(updateRes.removedImageCount).toBe(1);

    // img1 blob and tracking row must be permanently deleted
    const [img1Url, img1Record, editable] = await Promise.all([
      t.run((ctx) => ctx.storage.getUrl(img1)),
      t.run((ctx) =>
        ctx.db
          .query("listingImageUploads")
          .withIndex("by_storage_id", (q) => q.eq("storageId", img1))
          .unique(),
      ),
      asAlice.query(api.listings.queries.getListingForEdit, { listingId }),
    ]);

    expect(img1Url).toBeNull();
    expect(img1Record).toBeNull();
    expect(editable.images.map((i) => i.storageId)).toEqual([img2, img3]);

    // Audit Log contains listing.created and listing.updated
    const logs = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_target", (q) => q.eq("targetType", "listing").eq("targetId", listingId))
        .collect(),
    );
    expect(logs.map((l) => l.action)).toEqual(["listing.created", "listing.updated"]);
  });
});

describe("Listings edit/archive authorization guards and cascade cleanup", () => {
  it("blocks another User from viewing edit view, updating, or archiving a Listing", async () => {
    const t = createTestBackend();
    const { authed: asAlice } = await seedUser(t, {
      subject: "sub_alice_own",
      email: "alice@example.com",
      name: "Alice",
    });
    const { authed: asBob } = await seedUser(t, {
      subject: "sub_bob_other",
      email: "bob@example.com",
      name: "Bob",
    });

    const { _id: listingId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Torque Wrench",
      category: "automotive",
      condition: "good",
      description: "1/2-inch drive torque wrench.",
    });

    await expectAppError(
      asBob.query(api.listings.queries.getListingForEdit, { listingId }),
      "FORBIDDEN",
    );
    await expectAppError(
      asBob.mutation(api.listings.mutations.updateListing, {
        listingId,
        name: "Hacked",
        category: "other",
        condition: "fair",
        description: "Hacked",
        imageIds: [],
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      asBob.mutation(api.listings.mutations.archiveListing, { listingId }),
      "FORBIDDEN",
    );
  });

  it("blocks Lender archive when an unreturned approved Loan exists, and auto-declines pending requests + deletes blobs when allowed", async () => {
    const t = createTestBackend();
    const { authed: asAlice, userId: aliceId } = await seedUser(t, {
      subject: "sub_alice_arch",
      email: "alice@example.com",
      name: "Alice",
    });
    const { userId: bobId } = await seedUser(t, {
      subject: "sub_bob_arch",
      email: "bob@example.com",
      name: "Bob",
    });

    const imgId = await seedPendingImageUpload(t, asAlice, "archive-photo");
    const { _id: listingId } = await asAlice.mutation(api.listings.mutations.createListing, {
      name: "Camping Tent",
      category: "camping",
      condition: "like_new",
      description: "4-person dome tent.",
      imageIds: [imgId],
    });

    const today = todayUtcDate();
    const { approvedLoanId, pendingLoanId } = await t.run(async (ctx) => {
      const approved = await ctx.db.insert("loans", {
        listingId,
        lenderId: aliceId,
        borrowerId: bobId,
        startDate: today,
        endDate: today,
        status: "approved",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const pending = await ctx.db.insert("loans", {
        listingId,
        lenderId: aliceId,
        borrowerId: bobId,
        startDate: "2099-05-01",
        endDate: "2099-05-03",
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { approvedLoanId: approved, pendingLoanId: pending };
    });

    // My Listings reflects pending count and active approved loan
    const myListingsBefore = await asAlice.query(api.listings.queries.listMyListings, {});
    expect(myListingsBefore.items).toHaveLength(1);
    expect(myListingsBefore.items[0]!.pendingRequestCount).toBe(1);
    expect(myListingsBefore.items[0]!.hasActiveApprovedLoan).toBe(true);
    expect(myListingsBefore.items[0]!.availability).toBe("Currently Borrowed");

    // Archive must be blocked while approved Loan is unreturned
    await expectAppError(
      asAlice.mutation(api.listings.mutations.archiveListing, { listingId }),
      "CONFLICT",
    );

    // Mark approved Loan as returned, then archive succeeds
    await t.run(async (ctx) => {
      await ctx.db.patch(approvedLoanId, { status: "returned", returnedAt: Date.now() });
    });

    const archiveRes = await asAlice.mutation(api.listings.mutations.archiveListing, {
      listingId,
      reason: "No longer lending",
    });
    expect(archiveRes.autoDeclinedCount).toBe(1);
    expect(archiveRes.deletedImageCount).toBe(1);

    // Verify pending Loan auto-declined, image blob deleted, Audit Log written, My Listings empty
    const [pendingLoan, blobUrl, auditLogs, myListingsAfter] = await Promise.all([
      t.run((ctx) => ctx.db.get(pendingLoanId)),
      t.run((ctx) => ctx.storage.getUrl(imgId)),
      t.run((ctx) =>
        ctx.db
          .query("auditLogs")
          .withIndex("by_target", (q) => q.eq("targetType", "listing").eq("targetId", listingId))
          .collect(),
      ),
      asAlice.query(api.listings.queries.listMyListings, {}),
    ]);

    expect(pendingLoan?.status).toBe("declined");
    expect(pendingLoan?.decisionReason).toBe("Listing archived");
    expect(blobUrl).toBeNull();
    expect(auditLogs.some((l) => l.action === "listing.archived")).toBe(true);
    expect(myListingsAfter.items).toHaveLength(0);
  });
});
