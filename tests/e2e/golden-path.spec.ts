import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const GOLDEN_ENABLED = process.env.E2E_GOLDEN_ENABLED === "true";
const LENDER_EMAIL = process.env.E2E_LENDER_EMAIL?.trim() ?? "";
const LENDER_PASSWORD = process.env.E2E_LENDER_PASSWORD ?? "";
const BORROWER_EMAIL = process.env.E2E_BORROWER_EMAIL?.trim() ?? "";
const BORROWER_PASSWORD = process.env.E2E_BORROWER_PASSWORD ?? "";
const MAILPIT_API_URL = process.env.MAILPIT_API_URL?.trim() ?? "";

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string; Name: string }>;
  Snippet: string;
}

function addUtcDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createSampleJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 42, g: 120, b: 185 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function signInWithClerk(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");

  const identifierInput = page.locator('input[name="identifier"]');
  await expect(identifierInput).toBeVisible({ timeout: 20_000 });
  await identifierInput.fill(email);

  const passwordInput = page.locator('input[name="password"]');
  if (!(await passwordInput.isVisible())) {
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  }
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /^continue$/i }).click();

  await expect(page).toHaveURL(/\/(listings|my-listings|my-requests|incoming-requests)/, {
    timeout: 30_000,
  });
}

async function selectUtcCalendarDate(page: Page, utcDate: string): Promise<void> {
  const targetButton = page.locator(`button[aria-label="${utcDate}"]`);
  for (let i = 0; i < 3; i += 1) {
    if (await targetButton.isVisible()) {
      await targetButton.click();
      return;
    }
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await expect(targetButton).toBeVisible();
  await targetButton.click();
}

test.describe("Authenticated Golden-Path E2E (Clerk test keys + Convex dev)", () => {
  test.skip(
    !GOLDEN_ENABLED || !LENDER_EMAIL || !LENDER_PASSWORD || !BORROWER_EMAIL || !BORROWER_PASSWORD,
    "Set E2E_GOLDEN_ENABLED=true and E2E_LENDER_*/E2E_BORROWER_* credentials to run the authenticated golden-path suite.",
  );

  test("sign-in -> create Listing with sanitized photo -> request Loan as Borrower -> approve as Lender -> verify notification delivery", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    if (MAILPIT_API_URL) {
      await request.delete(`${MAILPIT_API_URL}/api/v1/messages`);
    }

    const uniqueListingName = `Golden Path Cordless Saw ${Date.now()}`;
    const startDate = addUtcDays(2);
    const endDate = addUtcDays(3);
    const photoBuffer = await createSampleJpegBuffer();

    const lenderContext = await browser.newContext();
    const borrowerContext = await browser.newContext();
    const lenderPage = await lenderContext.newPage();
    const borrowerPage = await borrowerContext.newPage();

    try {
      // 1. Lender signs in and creates a Listing with a sanitized photo
      await signInWithClerk(lenderPage, LENDER_EMAIL, LENDER_PASSWORD);
      await lenderPage.goto("/listings/new");

      await lenderPage.locator("#listing-name").fill(uniqueListingName);
      await lenderPage.locator("#listing-category").selectOption("power_tools");
      await lenderPage.locator("#listing-condition").selectOption("like_new");
      await lenderPage
        .locator("#listing-description")
        .fill("Includes 20V battery, charger, and carrying case for golden-path E2E verification.");

      await lenderPage.locator('input[aria-label="Upload Listing photos"]').setInputFiles({
        name: "golden-path-saw.jpg",
        mimeType: "image/jpeg",
        buffer: photoBuffer,
      });

      // Wait for server sharp sanitization + Convex _storage upload to finish
      await expect(lenderPage.getByText("Cover", { exact: true })).toBeVisible({ timeout: 20_000 });
      await lenderPage.getByRole("button", { name: "Publish Listing" }).click();

      await expect(lenderPage).toHaveURL(/\/my-listings/, { timeout: 20_000 });
      await expect(lenderPage.getByText(uniqueListingName)).toBeVisible({ timeout: 15_000 });

      // 2. Borrower signs in, opens the new Listing, and requests a Loan
      await signInWithClerk(borrowerPage, BORROWER_EMAIL, BORROWER_PASSWORD);
      await borrowerPage.goto("/listings");

      const listingLink = borrowerPage.getByRole("link", { name: uniqueListingName }).first();
      await expect(listingLink).toBeVisible({ timeout: 20_000 });
      await listingLink.click();

      await expect(borrowerPage).toHaveURL(/\/listings\/.+/, { timeout: 15_000 });
      await expect(borrowerPage.getByRole("heading", { name: uniqueListingName })).toBeVisible();

      // Verify uploaded photo is rendered from Convex storage
      const heroImage = borrowerPage.locator("main img").first();
      await expect(heroImage).toBeVisible({ timeout: 15_000 });
      const imageSrc = await heroImage.getAttribute("src");
      expect(imageSrc).toBeTruthy();

      await selectUtcCalendarDate(borrowerPage, startDate);
      await selectUtcCalendarDate(borrowerPage, endDate);
      await borrowerPage
        .locator("#borrow-note")
        .fill("Need it for trimming shelves this weekend — thanks!");
      await borrowerPage.getByRole("button", { name: "Request Loan" }).click();

      await expect(borrowerPage).toHaveURL(/\/my-requests/, { timeout: 20_000 });
      const borrowerLoanCard = borrowerPage
        .locator("article")
        .filter({ hasText: uniqueListingName })
        .first();
      await expect(borrowerLoanCard).toBeVisible({ timeout: 15_000 });
      await expect(borrowerLoanCard.getByText("Pending", { exact: true })).toBeVisible();

      // 3. Lender opens Incoming Requests and approves the Loan
      await lenderPage.goto("/incoming-requests");
      const lenderLoanCard = lenderPage
        .locator("article")
        .filter({ hasText: uniqueListingName })
        .first();
      await expect(lenderLoanCard).toBeVisible({ timeout: 20_000 });

      await lenderLoanCard.getByRole("button", { name: "Approve" }).click();
      await lenderPage.getByRole("button", { name: "Confirm Approval" }).click();

      await expect(lenderLoanCard.getByText("Approved", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // 4. Verify automated notification delivery (Mailpit API when configured + Automation Activity timeline)
      if (MAILPIT_API_URL) {
        let relatedMessages: MailpitMessageSummary[] = [];
        await expect
          .poll(
            async () => {
              const res = await request.get(`${MAILPIT_API_URL}/api/v1/messages`);
              if (!res.ok()) return 0;
              const data = (await res.json()) as { messages: MailpitMessageSummary[] };
              relatedMessages = data.messages.filter((m) => m.Subject.includes(uniqueListingName));
              return relatedMessages.length;
            },
            { timeout: 30_000, intervals: [1000, 2000, 3000] },
          )
          .toBeGreaterThanOrEqual(2);

        const recipients = relatedMessages.flatMap((m) => m.To.map((t) => t.Address.toLowerCase()));
        expect(recipients).toContain(LENDER_EMAIL.toLowerCase());
        expect(recipients).toContain(BORROWER_EMAIL.toLowerCase());
      } else {
        await expect(lenderLoanCard.getByText(/Notification sent/i)).toBeVisible({
          timeout: 30_000,
        });
      }
    } finally {
      await lenderContext.close();
      await borrowerContext.close();
    }
  });
});
