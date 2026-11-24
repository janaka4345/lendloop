import { ConvexError } from "convex/values";
import { formatStructuredLog } from "../../src/domain/redaction";

export type AppErrorCode =
  "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT" | "RATE_LIMITED";

export type AppErrorData = {
  code: AppErrorCode;
  message: string;
};

export function createAppError(
  code: AppErrorCode,
  message: string,
  logContext?: Record<string, unknown>,
): ConvexError<AppErrorData> {
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN" || code === "RATE_LIMITED") {
    console.warn(
      formatStructuredLog({
        level: "warn",
        event: `security.${code.toLowerCase()}`,
        code,
        context: logContext,
      }),
    );
  }
  return new ConvexError<AppErrorData>({ code, message });
}
