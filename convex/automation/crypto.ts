const encoder = new TextEncoder();

export const AUTOMATION_JWT_ISSUER = "convex";
export const AUTOMATION_JWT_AUDIENCE = "n8n-automation";
export const AUTOMATION_JWT_TTL_SECONDS = 60;

export interface AutomationJwtPayload {
  iss: string;
  aud: string;
  jti: string;
  bodySha256: string;
  iat: number;
  exp: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stringToBase64Url(input: string): string {
  return bytesToBase64Url(encoder.encode(input));
}

function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function signAutomationJwt(params: {
  secret: string;
  jti: string;
  bodySha256: string;
  nowSeconds?: number;
  ttlSeconds?: number;
  iss?: string;
  aud?: string;
}): Promise<string> {
  const iat = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? AUTOMATION_JWT_TTL_SECONDS;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AutomationJwtPayload = {
    iss: params.iss ?? AUTOMATION_JWT_ISSUER,
    aud: params.aud ?? AUTOMATION_JWT_AUDIENCE,
    jti: params.jti,
    bodySha256: params.bodySha256,
    iat,
    exp: iat + ttl,
  };

  const encodedHeader = stringToBase64Url(JSON.stringify(header));
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(params.secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const encodedSignature = bytesToBase64Url(new Uint8Array(signature));

  return `${signingInput}.${encodedSignature}`;
}

export type VerifyAutomationJwtResult =
  | { ok: true; payload: AutomationJwtPayload }
  | {
      ok: false;
      code:
        | "MALFORMED_TOKEN"
        | "INVALID_SIGNATURE"
        | "TOKEN_EXPIRED"
        | "INVALID_CLAIMS"
        | "BODY_HASH_MISMATCH";
    };

export async function verifyAutomationJwt(params: {
  token: string;
  secret: string;
  rawBody: string;
  nowSeconds?: number;
  expectedIss?: string;
  expectedAud?: string;
}): Promise<VerifyAutomationJwtResult> {
  const parts = params.token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "MALFORMED_TOKEN" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return { ok: false, code: "MALFORMED_TOKEN" };
  }

  let header: { alg?: unknown; typ?: unknown };
  let payload: Partial<AutomationJwtPayload>;
  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    header = JSON.parse(base64UrlToString(encodedHeader)) as { alg?: unknown; typ?: unknown };
    payload = JSON.parse(base64UrlToString(encodedPayload)) as Partial<AutomationJwtPayload>;
    signatureBytes = base64UrlToBytes(encodedSignature);
  } catch {
    return { ok: false, code: "MALFORMED_TOKEN" };
  }

  if (header.alg !== "HS256") {
    return { ok: false, code: "MALFORMED_TOKEN" };
  }

  const key = await importHmacKey(params.secret, ["verify"]);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(signingInput),
  );
  if (!validSignature) {
    return { ok: false, code: "INVALID_SIGNATURE" };
  }

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now >= payload.exp) {
    return { ok: false, code: "TOKEN_EXPIRED" };
  }

  const expectedIss = params.expectedIss ?? AUTOMATION_JWT_ISSUER;
  const expectedAud = params.expectedAud ?? AUTOMATION_JWT_AUDIENCE;
  if (
    payload.iss !== expectedIss ||
    payload.aud !== expectedAud ||
    typeof payload.jti !== "string" ||
    payload.jti.trim().length === 0 ||
    typeof payload.bodySha256 !== "string" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, code: "INVALID_CLAIMS" };
  }

  const computedHash = await sha256Hex(params.rawBody);
  const hashMatches = await constantTimeEqual(computedHash, payload.bodySha256);
  if (!hashMatches) {
    return { ok: false, code: "BODY_HASH_MISMATCH" };
  }

  return {
    ok: true,
    payload: payload as AutomationJwtPayload,
  };
}

/**
 * Constant-time string comparison backed by Web Crypto `crypto.subtle.verify`
 * using an ephemeral HMAC-SHA256 key so differing lengths do not leak timing.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  const macB = await crypto.subtle.sign("HMAC", key, encoder.encode(b));
  return crypto.subtle.verify("HMAC", key, macB, encoder.encode(a));
}

export async function verifyServiceToken(
  provided: string | null,
  currentToken: string | undefined,
  previousToken?: string | undefined,
): Promise<{ valid: boolean; usedPrevious: boolean }> {
  const trimmedProvided = (provided ?? "").trim();
  const trimmedCurrent = (currentToken ?? "").trim();
  const trimmedPrevious = (previousToken ?? "").trim();

  if (!trimmedProvided || (!trimmedCurrent && !trimmedPrevious)) {
    return { valid: false, usedPrevious: false };
  }

  const matchesCurrent = trimmedCurrent
    ? await constantTimeEqual(trimmedProvided, trimmedCurrent)
    : false;
  const matchesPrevious = trimmedPrevious
    ? await constantTimeEqual(trimmedProvided, trimmedPrevious)
    : false;

  if (matchesCurrent) {
    return { valid: true, usedPrevious: false };
  }
  if (matchesPrevious) {
    return { valid: true, usedPrevious: true };
  }
  return { valid: false, usedPrevious: false };
}
