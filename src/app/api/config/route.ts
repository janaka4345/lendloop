import { NextResponse } from "next/server";
import { validateRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = validateRuntimeConfig(process.env);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Runtime configuration unavailable",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(result.publicConfig, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
