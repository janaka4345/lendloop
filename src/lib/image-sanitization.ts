import sharp, { type Metadata } from "sharp";

// Memory-safe global sharp settings for lean 0.5 GB container runtimes
sharp.cache(false);
sharp.concurrency(1);

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_DIMENSION_PX = 1600;
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000;
export const OUTPUT_WEBP_QUALITY = 82;

export const ALLOWED_INPUT_MIME_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

const ALLOWED_SHARP_FORMATS = new Set<string>(["jpeg", "png", "webp"]);

export class ImageSanitizationError extends Error {
  readonly statusCode: 400 | 413 | 415;
  readonly code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "INVALID_IMAGE";

  constructor(
    statusCode: 400 | 413 | 415,
    code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "INVALID_IMAGE",
    message: string,
  ) {
    super(message);
    this.name = "ImageSanitizationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface SanitizedImageResult {
  buffer: Buffer;
  contentType: "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * Validates raster-only JPEG/PNG/WebP uploads (strictly rejecting SVG, GIF, HTML, and non-images),
 * enforces the 5 MB cap, decodes memory-safely with `sharp`, and re-encodes to WebP (max 1600×1600)
 * stripping all EXIF/GPS/XMP metadata and neutralizing polyglots.
 */
export async function sanitizeListingImageBuffer(
  input: Buffer,
  declaredMimeType?: string,
): Promise<SanitizedImageResult> {
  if (!input || input.byteLength === 0) {
    throw new ImageSanitizationError(400, "EMPTY_FILE", "Uploaded image file is empty.");
  }

  if (input.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ImageSanitizationError(
      413,
      "FILE_TOO_LARGE",
      "Photo exceeds the 5 MB maximum file size.",
    );
  }

  if (declaredMimeType) {
    const normalizedMime = declaredMimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_INPUT_MIME_TYPES.has(normalizedMime)) {
      throw new ImageSanitizationError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Only JPEG, PNG, and WebP raster photos are supported.",
      );
    }
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      failOn: "error",
    }).metadata();
  } catch {
    throw new ImageSanitizationError(
      415,
      "INVALID_IMAGE",
      "Unable to decode image. Please upload a valid JPEG, PNG, or WebP photo.",
    );
  }

  if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    throw new ImageSanitizationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Only JPEG, PNG, and WebP raster photos are supported.",
    );
  }

  try {
    // `.rotate()` applies EXIF orientation to pixels before stripping all metadata on WebP encode.
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      failOn: "error",
    })
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION_PX,
        height: MAX_IMAGE_DIMENSION_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: OUTPUT_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    if (data.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ImageSanitizationError(
        413,
        "FILE_TOO_LARGE",
        "Processed photo exceeds the 5 MB maximum file size.",
      );
    }

    return {
      buffer: data,
      contentType: "image/webp",
      sizeBytes: data.byteLength,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof ImageSanitizationError) {
      throw error;
    }
    throw new ImageSanitizationError(
      400,
      "INVALID_IMAGE",
      "Failed to process image. Please try a different JPEG, PNG, or WebP photo.",
    );
  }
}
