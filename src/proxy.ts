import { NextResponse, type NextRequest } from "next/server";
import { buildSecurityHeaders } from "@/lib/security-headers";

function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    const firstHopProto = forwardedProto.split(",")[0]?.trim().toLowerCase();
    return firstHopProto === "https";
  }
  return request.nextUrl.protocol === "https:";
}

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  const securityHeaders = buildSecurityHeaders(process.env, {
    isHttpsRequest: isHttpsRequest(request),
  });
  for (const [headerName, headerValue] of Object.entries(securityHeaders)) {
    response.headers.set(headerName, headerValue);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next.js assets.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
