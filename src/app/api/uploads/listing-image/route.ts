import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AppErrorData } from "../../../../../convex/lib/errors";
import {
  ImageSanitizationError,
  MAX_IMAGE_UPLOAD_BYTES,
  sanitizeListingImageBuffer,
} from "@/lib/image-sanitization";
import { validateRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapConvexErrorStatus(code: AppErrorData["code"]): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "VALIDATION_ERROR":
    default:
      return 400;
  }
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId, getToken } = await auth();
  if (!userId) {
    return jsonNoStore({ error: "Authentication is required." }, 401);
  }

  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) {
    return jsonNoStore({ error: "Unable to authenticate upload session." }, 401);
  }

  const configResult = validateRuntimeConfig(process.env);
  if (!configResult.ok) {
    return jsonNoStore({ error: "Server storage configuration is unavailable." }, 503);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    // Allow small multipart framing overhead over the 5 MB file cap
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_UPLOAD_BYTES + 256 * 1024) {
      return jsonNoStore({ error: "Photo exceeds the 5 MB maximum file size." }, 413);
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonNoStore({ error: "Expected multipart/form-data upload." }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonNoStore({ error: "A photo file field is required." }, 400);
  }

  if (file.size === 0) {
    return jsonNoStore({ error: "Uploaded image file is empty." }, 400);
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return jsonNoStore({ error: "Photo exceeds the 5 MB maximum file size." }, 413);
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());

  let sanitized: Awaited<ReturnType<typeof sanitizeListingImageBuffer>>;
  try {
    sanitized = await sanitizeListingImageBuffer(inputBuffer, file.type || undefined);
  } catch (error) {
    if (error instanceof ImageSanitizationError) {
      return jsonNoStore({ error: error.message }, error.statusCode);
    }
    return jsonNoStore({ error: "Invalid image upload." }, 400);
  }

  const convex = new ConvexHttpClient(configResult.publicConfig.convexUrl);
  convex.setAuth(convexToken);

  try {
    const { uploadUrl } = await convex.mutation(
      api.listings.mutations.generateListingImageUploadUrl,
      {},
    );

    const storageResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": sanitized.contentType,
      },
      body: new Uint8Array(sanitized.buffer),
    });

    if (!storageResponse.ok) {
      return jsonNoStore({ error: "Failed to store sanitized photo. Please try again." }, 502);
    }

    const storagePayload = (await storageResponse.json()) as { storageId?: string };
    if (!storagePayload.storageId) {
      return jsonNoStore({ error: "Storage service did not return a valid photo ID." }, 502);
    }

    const registered = await convex.mutation(api.listings.mutations.registerListingImageUpload, {
      storageId: storagePayload.storageId as Id<"_storage">,
      contentType: sanitized.contentType,
      sizeBytes: sanitized.sizeBytes,
      width: sanitized.width,
      height: sanitized.height,
    });

    return jsonNoStore(registered, 201);
  } catch (error) {
    if (error instanceof ConvexError) {
      const data = error.data as Partial<AppErrorData> | undefined;
      if (data?.code && data?.message) {
        return jsonNoStore(
          { error: data.message, code: data.code },
          mapConvexErrorStatus(data.code),
        );
      }
    }
    return jsonNoStore({ error: "Unable to complete photo upload. Please try again." }, 500);
  }
}
