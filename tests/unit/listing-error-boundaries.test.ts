import React, { type Component, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
  };
});

vi.mock("@/components/providers/app-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/providers/app-providers")>();
  return {
    ...actual,
    useHasConvexProvider: () => true,
    useSyncedCurrentUser: () => null,
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/listings/listing_a",
}));

import { ListingDetailWorkbench } from "@/features/lending/components/listing-detail-workbench";
import { EditListingView } from "@/features/listings/components/edit-listing-view";

type ErrorBoundaryClass = {
  new (props: Record<string, unknown>): Component<Record<string, unknown>, { error: unknown }>;
  getDerivedStateFromError?: (error: unknown) => { error: unknown };
};

function findButtonByText(
  node: ReactNode,
  label: string,
): ReactElement<{ onClick?: () => void }> | null {
  if (!node || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findButtonByText(child, label);
      if (match) return match;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode; onClick?: () => void };
    if (typeof props.onClick === "function") {
      const markup = renderToStaticMarkup(node);
      if (markup.includes(label)) {
        return node as ReactElement<{ onClick?: () => void }>;
      }
    }
    if (props.children) {
      return findButtonByText(props.children, label);
    }
  }
  return null;
}

function mountBoundaryFromElement(element: ReactElement) {
  const BoundaryCtor = element.type as unknown as ErrorBoundaryClass;
  const props = {
    ...(element.props as Record<string, unknown>),
    children: React.createElement("div", { "data-testid": "ok-child" }, "Child Content"),
  };
  const instance = new BoundaryCtor(props);
  const mutableInstance = instance as unknown as {
    props: Record<string, unknown>;
    state: { error: unknown };
  };
  mutableInstance.props = props;
  instance.setState = (updater: unknown) => {
    const patch =
      typeof updater === "function"
        ? (
            updater as (
              prev: { error: unknown },
              p: Record<string, unknown>,
            ) => Partial<{ error: unknown }>
          )(instance.state, instance.props)
        : (updater as Partial<{ error: unknown }>);
    instance.state = { ...instance.state, ...patch };
  };

  return {
    key: element.key,
    instance,
    triggerError(error: unknown) {
      const derived = BoundaryCtor.getDerivedStateFromError?.(error);
      if (derived) {
        instance.state = { ...instance.state, ...derived };
      }
    },
    renderTree() {
      return instance.render();
    },
    renderHtml() {
      return renderToStaticMarkup(React.createElement(React.Fragment, null, instance.render()));
    },
    updateProps(nextProps: Record<string, unknown>) {
      const prevProps = instance.props;
      const prevState = instance.state;
      mutableInstance.props = { ...instance.props, ...nextProps };
      instance.componentDidUpdate?.(prevProps, prevState);
    },
  };
}

describe("ListingDetailErrorBoundary (via ListingDetailWorkbench)", () => {
  it("keys the error boundary by listingId so route changes remount it", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    expect(element.key).toBe("listing_a");
  });

  it("renders 'Listing not found' without a retry button for NOT_FOUND errors", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "NOT_FOUND", message: "Listing not found." }));
    const html = boundary.renderHtml();

    expect(html).toContain("Listing not found");
    expect(html).not.toContain("Try again");
  });

  it("differentiates UNAUTHENTICATED errors from NOT_FOUND and allows retry recovery", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(
      new ConvexError({ code: "UNAUTHENTICATED", message: "User has not been synced yet." }),
    );
    const tree = boundary.renderTree();
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));

    expect(html).not.toContain("Listing not found");
    expect(html).toContain("Try again");

    const retryButton = findButtonByText(tree, "Try again");
    expect(retryButton).not.toBeNull();
    retryButton!.props.onClick?.();

    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });

  it("differentiates FORBIDDEN errors from NOT_FOUND without showing Try again", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "FORBIDDEN", message: "Access denied." }));
    const html = boundary.renderHtml();

    expect(html).not.toContain("Listing not found");
    expect(html).toContain("Permission denied");
    expect(html).not.toContain("Try again");
  });

  it("differentiates transient/unknown errors from NOT_FOUND and allows retry recovery", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new Error("Network request failed"));
    const tree = boundary.renderTree();
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));

    expect(html).not.toContain("Listing not found");
    expect(html).toContain("Try again");

    const retryButton = findButtonByText(tree, "Try again");
    expect(retryButton).not.toBeNull();
    retryButton!.props.onClick?.();

    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });

  it("resets error state in componentDidUpdate when listingId changes", () => {
    const element = ListingDetailWorkbench({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "NOT_FOUND", message: "Listing not found." }));
    expect(boundary.renderHtml()).toContain("Listing not found");

    boundary.updateProps({ listingId: "listing_b" });
    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });
});

describe("EditListingErrorBoundary (via EditListingView)", () => {
  it("keys the error boundary by listingId so route changes remount it", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    expect(element.key).toBe("listing_a");
  });

  it("renders Permission denied without Try again for FORBIDDEN errors", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "FORBIDDEN", message: "Not the Lender." }));
    const html = boundary.renderHtml();

    expect(html).toContain("Permission denied");
    expect(html).toContain("Back to Listing");
    expect(html).not.toContain("Try again");
  });

  it("renders Listing not found without Try again for NOT_FOUND errors", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "NOT_FOUND", message: "Listing not found." }));
    const html = boundary.renderHtml();

    expect(html).toContain("Listing not found");
    expect(html).not.toContain("Try again");
  });

  it("differentiates UNAUTHENTICATED errors and provides Try again recovery", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(
      new ConvexError({ code: "UNAUTHENTICATED", message: "User has not been synced yet." }),
    );
    const tree = boundary.renderTree();
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));

    expect(html).not.toContain("Unable to edit Listing");
    expect(html).toContain("Try again");

    const retryButton = findButtonByText(tree, "Try again");
    expect(retryButton).not.toBeNull();
    retryButton!.props.onClick?.();

    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });

  it("provides Try again recovery for transient/unknown errors", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new Error("Temporary network error"));
    const tree = boundary.renderTree();
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, tree));

    expect(html).toContain("Unable to edit Listing");
    expect(html).toContain("Try again");

    const retryButton = findButtonByText(tree, "Try again");
    expect(retryButton).not.toBeNull();
    retryButton!.props.onClick?.();

    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });

  it("resets error state in componentDidUpdate when listingId changes", () => {
    const element = EditListingView({ listingId: "listing_a" }) as ReactElement;
    const boundary = mountBoundaryFromElement(element);

    boundary.triggerError(new ConvexError({ code: "NOT_FOUND", message: "Listing not found." }));
    expect(boundary.renderHtml()).toContain("Listing not found");

    boundary.updateProps({ listingId: "listing_b" });
    expect(boundary.instance.state.error).toBeNull();
    expect(boundary.renderHtml()).toContain("Child Content");
  });
});
