import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type RecordedQueryCall = {
  queryName: string;
  args: unknown;
};

const GET_CURRENT_USER_FN = getFunctionName(api.users.queries.getCurrentUser);

let simulatedCurrentUser:
  | undefined
  | null
  | {
      _id: Id<"users">;
      displayName: string;
      email: string;
      role: "user" | "admin";
      trustedLender: boolean;
    } = null;

let simulatedAuthState = {
  isAuthenticated: true,
  isLoading: false,
};

let recordedCalls: RecordedQueryCall[] = [];

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useConvexAuth: () => simulatedAuthState,
    useMutation: () => vi.fn(),
    useQuery: (queryRef: FunctionReference<"query">, args: unknown) => {
      const queryName = getFunctionName(queryRef);
      recordedCalls.push({ queryName, args });
      if (queryName === GET_CURRENT_USER_FN) {
        return args === "skip" ? undefined : simulatedCurrentUser;
      }
      if (args === "skip") {
        return undefined;
      }
      if (!simulatedCurrentUser) {
        throw new ConvexError({
          code: "UNAUTHENTICATED",
          message: simulatedAuthState.isAuthenticated
            ? "User has not been synced yet."
            : "Authentication is required.",
        });
      }
      return undefined;
    },
  };
});

vi.mock("@/components/providers/app-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/providers/app-providers")>();
  return {
    ...actual,
    useHasConvexProvider: () => true,
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/listings",
}));

import { AllToolsCatalog } from "@/features/listings/components/all-tools-catalog";
import { EditListingView } from "@/features/listings/components/edit-listing-view";
import { MyListingsView } from "@/features/listings/components/my-listings-view";
import { ListingDetailWorkbench } from "@/features/lending/components/listing-detail-workbench";
import { LoansBoardView } from "@/features/lending/components/loans-board-view";

const SYNCED_USER = {
  _id: "user_1" as Id<"users">,
  displayName: "Alex Neighbor",
  email: "alex@example.com",
  role: "user" as const,
  trustedLender: false,
};

const TEST_LISTING_ID = "listing_1" as Id<"listings">;

const AUTHENTICATED_VIEWS: Array<{
  name: string;
  render: () => string;
  expectedQueryName: string;
}> = [
  {
    name: "AllToolsCatalog",
    render: () => renderToStaticMarkup(React.createElement(AllToolsCatalog)),
    expectedQueryName: getFunctionName(api.listings.queries.listCatalogListings),
  },
  {
    name: "MyListingsView",
    render: () => renderToStaticMarkup(React.createElement(MyListingsView)),
    expectedQueryName: getFunctionName(api.listings.queries.listMyListings),
  },
  {
    name: "ListingDetailWorkbench",
    render: () =>
      renderToStaticMarkup(
        React.createElement(ListingDetailWorkbench, { listingId: TEST_LISTING_ID }),
      ),
    expectedQueryName: getFunctionName(api.listings.queries.getListingDetail),
  },
  {
    name: "EditListingView",
    render: () =>
      renderToStaticMarkup(React.createElement(EditListingView, { listingId: TEST_LISTING_ID })),
    expectedQueryName: getFunctionName(api.listings.queries.getListingForEdit),
  },
  {
    name: "LoansBoardView (borrower)",
    render: () => renderToStaticMarkup(React.createElement(LoansBoardView, { mode: "borrower" })),
    expectedQueryName: getFunctionName(api.lending.queries.listMyRequests),
  },
  {
    name: "LoansBoardView (lender)",
    render: () => renderToStaticMarkup(React.createElement(LoansBoardView, { mode: "lender" })),
    expectedQueryName: getFunctionName(api.lending.queries.listIncomingRequests),
  },
];

describe("Authenticated view query gating during Clerk->Convex sync race windows", () => {
  beforeEach(() => {
    recordedCalls = [];
    simulatedAuthState = { isAuthenticated: true, isLoading: false };
    simulatedCurrentUser = null;
  });

  describe.each([
    {
      windowName: "Window 1 (JWT handoff / getCurrentUser loading)",
      authState: { isAuthenticated: false, isLoading: true },
      currentUser: undefined,
    },
    {
      windowName: "Window 2 (syncCurrentUser in flight / getCurrentUser null)",
      authState: { isAuthenticated: true, isLoading: false },
      currentUser: null,
    },
  ])("$windowName", ({ authState, currentUser }) => {
    it.each(AUTHENTICATED_VIEWS)(
      "$name skips its authenticated query and stays in loading state without throwing",
      ({ render, expectedQueryName }) => {
        simulatedAuthState = authState;
        simulatedCurrentUser = currentUser;

        const html = render();

        const targetCalls = recordedCalls.filter((call) => call.queryName === expectedQueryName);
        expect(targetCalls.length).toBeGreaterThan(0);
        expect(targetCalls.every((call) => call.args === "skip")).toBe(true);
        expect(html).not.toContain("Listing not found");
        expect(html).not.toContain("Unable to edit Listing");
      },
    );
  });

  describe("After user is synced (getCurrentUser returns User)", () => {
    it.each(AUTHENTICATED_VIEWS)(
      "$name subscribes to its authenticated query with non-skip args",
      ({ render, expectedQueryName }) => {
        simulatedAuthState = { isAuthenticated: true, isLoading: false };
        simulatedCurrentUser = SYNCED_USER;

        render();

        const targetCalls = recordedCalls.filter((call) => call.queryName === expectedQueryName);
        expect(targetCalls.length).toBeGreaterThan(0);
        expect(targetCalls.some((call) => call.args !== "skip")).toBe(true);
      },
    );
  });
});
