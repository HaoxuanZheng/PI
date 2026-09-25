import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export class ConnectionValidationError extends Error {
  readonly code = "VALIDATION_FAILED";
}

export class ConnectionCryptoError extends Error {
  readonly code = "CONNECTION_CRYPTO_FAILED";
}

/** Import-capable providers share one vault; Google dances first, Notion later. */
export const connectionProviderSchema = z.enum(["GOOGLE_DRIVE", "GOOGLE_CONTACTS", "NOTION"]);
export type ConnectionProvider = z.infer<typeof connectionProviderSchema>;

export type GoogleProvider = Extract<ConnectionProvider, "GOOGLE_DRIVE" | "GOOGLE_CONTACTS">;

const googleScopeMap: Record<GoogleProvider, string> = {
  GOOGLE_DRIVE: "https://www.googleapis.com/auth/drive.readonly",
  GOOGLE_CONTACTS: "https://www.googleapis.com/auth/contacts.readonly"
};

export function googleScopes(provider: GoogleProvider): string[] {
  return [googleScopeMap[provider]];
}

export function isGoogleProvider(provider: ConnectionProvider): provider is GoogleProvider {
  return provider === "GOOGLE_DRIVE" || provider === "GOOGLE_CONTACTS";
}

export const connectInputSchema = z.object({
  provider: connectionProviderSchema,
  accessToken: z.string().trim().min(1).max(8000),
  refreshToken: z.string().trim().min(1).max(8000).nullable().default(null),
  scopes: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  expiresInSeconds: z.number().int().min(60).max(31_540_000).nullable().default(null)
});
export type ConnectInput = z.infer<typeof connectInputSchema>;

export type ConnectionStatus = "connected" | "expired" | "absent";

const algorithm = "aes-256-gcm";
const ivBytes = 12;

/** 32-byte key as 64 hex characters from server-only environment. */
export function parseTokenKey(raw: string | undefined): Buffer {
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new ConnectionCryptoError("Token encryption key must be 64 hex characters");
  }
  return Buffer.from(raw, "hex");
}

export type SealedToken = { iv: string; data: string; tag: string };

/** Seals one token with a fresh IV; the key never leaves environment. */
export function sealToken(key: Buffer, plaintext: string): SealedToken {
  if (key.length !== 32) throw new ConnectionCryptoError("Token encryption key must be 32 bytes");
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(algorithm, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function openToken(key: Buffer, sealed: SealedToken): string {
  if (key.length !== 32) throw new ConnectionCryptoError("Token encryption key must be 32 bytes");
  try {
    const decipher = createDecipheriv(algorithm, key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, "base64")),
      decipher.final()
    ]).toString("utf8");
    return plaintext;
  } catch {
    throw new ConnectionCryptoError("Stored token cannot be decrypted with the current key");
  }
}

export function expiryFromNow(expiresInSeconds: number | null): Date | null {
  if (expiresInSeconds === null) return null;
  return new Date(Date.now() + expiresInSeconds * 1_000);
}

export function connectionStatusOf(expiresAt: Date | null, now = Date.now()): ConnectionStatus {
  if (!expiresAt) return "connected";
  return expiresAt.getTime() <= now ? "expired" : "connected";
}

const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";

export const googleTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.literal("Bearer")
});
export type GoogleTokenSet = z.infer<typeof googleTokenSchema>;

/** Consent URL for the provider's read-only scopes. State is caller-managed. */
export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  provider: GoogleProvider;
  state: string;
}): string {
  const url = new URL(googleAuthorizationEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleScopes(input.provider).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function postTokenForm(body: Record<string, string>): Promise<GoogleTokenSet> {
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString()
  });
  if (!response.ok) {
    throw new ConnectionValidationError("Google token exchange failed");
  }
  return googleTokenSchema.parse(await response.json());
}

/** Exchanges an authorization code. Google returns a refresh token on first consent. */
export function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GoogleTokenSet> {
  return postTokenForm({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code: input.code
  });
}

/** Rotates an expired access token. Google may omit new refresh tokens here. */
export function refreshGoogleToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokenSet> {
  return postTokenForm({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken
  });
}
