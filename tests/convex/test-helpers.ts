import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import schema from "../../convex/schema";
import type { AppErrorCode, AppErrorData } from "../../convex/lib/errors";

const modules = import.meta.glob("../../convex/**/*.*s");

export function createTestBackend() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiter");
  return t;
}

export async function expectAppError(
  promise: Promise<unknown>,
  expectedCode: AppErrorCode,
): Promise<AppErrorData> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<AppErrorData>).data;
    expect(data.code).toBe(expectedCode);
    return data;
  }
  throw new Error(`Expected ConvexError with code ${expectedCode}, but promise resolved`);
}
