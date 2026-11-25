const MAX_CLIENT_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CLIENT_DIMENSION = 1600;
const CLIENT_WEBP_QUALITY = 0.85;

export const ALLOWED_CLIENT_IMAGE_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function validateClientImageFile(file: File): string | null {
  if (!ALLOWED_CLIENT_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "Only JPEG, PNG, and WebP photos are supported.";
  }
  if (file.size === 0) {
    return "Selected photo file is empty.";
  }
  if (file.size > MAX_CLIENT_BYTES) {
    return "Photo exceeds the 5 MB maximum file size.";
  }
  return null;
}

/**
 * Client-side pre-processing via `createImageBitmap` + `OffscreenCanvas` to resize and
 * convert large camera images to WebP before uploading to `/api/uploads/listing-image`.
 * Falls back gracefully to the original file if browser APIs are unavailable.
 */
export async function preprocessImageForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_CLIENT_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
      const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
      const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return file;
      }

      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const webpBlob = await canvas.convertToBlob({
        type: "image/webp",
        quality: CLIENT_WEBP_QUALITY,
      });

      if (webpBlob.size === 0 || webpBlob.size > MAX_CLIENT_BYTES) {
        return file;
      }

      const baseName = file.name.replace(/\.[^.]+$/, "") || "listing-photo";
      return new File([webpBlob], `${baseName}.webp`, { type: "image/webp" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
