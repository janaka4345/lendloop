import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isSyntheticClerkKey } from "@/lib/runtime-config";
import { buildSecurityHeaders } from "@/lib/security-headers";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/healthz",
  "/readyz",
  "/api/config",
]);

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    const firstHopProto = forwardedProto.split(",")[0]?.trim().toLowerCase();
    return firstHopProto === "https";
  }
  return request.nextUrl.protocol === "https:";
}

function applySecurityHeaders(response: Response, request: NextRequest): Response {
  const securityHeaders = buildSecurityHeaders(process.env, {
    isHttpsRequest: isHttpsRequest(request),
  });
  for (const [headerName, headerValue] of Object.entries(securityHeaders)) {
    response.headers.set(headerName, headerValue);
  }
  return response;
}

const clerkProxyHandler = clerkMiddleware(
  async (auth, request) => {
    if (!isPublicRoute(request)) {
      const { userId } = await auth();
      if (!userId) {
        const signInUrl = new URL("/sign-in", request.url);
        const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
        signInUrl.searchParams.set("redirect_url", returnPath);
        return NextResponse.redirect(signInUrl);
      }
    }

    return NextResponse.next();
  },
  () => ({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  }),
);

export async function proxy(request: NextRequest, event: NextFetchEvent): Promise<Response> {
  if (isPublicRoute(request) && isSyntheticClerkKey(process.env.CLERK_PUBLISHABLE_KEY)) {
    return applySecurityHeaders(NextResponse.next(), request);
  }

  const result = await clerkProxyHandler(request, event);
  if (result) {
    return applySecurityHeaders(result, request);
  }
  return applySecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next.js assets.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
