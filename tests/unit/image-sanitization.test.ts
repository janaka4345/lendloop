import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageSanitizationError,
  MAX_IMAGE_DIMENSION_PX,
  MAX_IMAGE_UPLOAD_BYTES,
  sanitizeListingImageBuffer,
} from "@/lib/image-sanitization";

describe("Server-side Listing image sanitization (sharp)", () => {
  it("re-encodes JPEG to WebP, caps dimensions to 1600x1600, and strips EXIF/GPS metadata", async () => {
    const jpegWithExif = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 40, g: 120, b: 200 },
      },
    })
      .jpeg({ quality: 85 })
      .withExif({
        IFD0: {
          Make: "TestCamera",
          ImageDescription: "Secret Home Address 123 Main St",
        },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLongitudeRef: "W",
        },
      })
      .toBuffer();

    const inputMeta = await sharp(jpegWithExif).metadata();
    expect(inputMeta.format).toBe("jpeg");
    expect(inputMeta.exif).toBeDefined();

    const result = await sanitizeListingImageBuffer(jpegWithExif, "image/jpeg");
    expect(result.contentType).toBe("image/webp");
    expect(result.width).toBe(MAX_IMAGE_DIMENSION_PX);
    expect(result.height).toBe(1200);
    expect(result.sizeBytes).toBe(result.buffer.byteLength);

    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.format).toBe("webp");
    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.xmp).toBeUndefined();
    expect(outputMeta.iptc).toBeUndefined();
    expect(result.buffer.toString("utf8")).not.toContain("Secret Home Address");
  });

  it("accepts PNG and WebP without enlarging small images", async () => {
    const pngBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await sanitizeListingImageBuffer(pngBuffer, "image/png");
    expect(result.contentType).toBe("image/webp");
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("strictly rejects SVG, GIF, HTML, spoofed MIME types, empty files, and >5 MB payloads", async () => {
    const svgBuffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
    );

    // SVG with image/svg+xml
    await expect(sanitizeListingImageBuffer(svgBuffer, "image/svg+xml")).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });

    // SVG spoofed as image/jpeg
    await expect(sanitizeListingImageBuffer(svgBuffer, "image/jpeg")).rejects.toBeInstanceOf(
      ImageSanitizationError,
    );

    // Plain HTML / text
    await expect(
      sanitizeListingImageBuffer(Buffer.from("<html><body>hi</body></html>"), "image/png"),
    ).rejects.toMatchObject({ statusCode: 415 });

    // GIF rejected
    const gifBuffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .gif()
      .toBuffer();
    await expect(sanitizeListingImageBuffer(gifBuffer, "image/gif")).rejects.toMatchObject({
      statusCode: 415,
    });
    await expect(sanitizeListingImageBuffer(gifBuffer, "image/png")).rejects.toMatchObject({
      statusCode: 415,
    });

    // Empty buffer
    await expect(sanitizeListingImageBuffer(Buffer.alloc(0), "image/jpeg")).rejects.toMatchObject({
      statusCode: 400,
      code: "EMPTY_FILE",
    });

    // Oversized buffer (>5 MB)
    const oversized = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1, 0xff);
    await expect(sanitizeListingImageBuffer(oversized, "image/jpeg")).rejects.toMatchObject({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
    });
  });
});
