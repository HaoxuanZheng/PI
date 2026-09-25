import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConnectionCryptoError,
  connectionStatusOf,
  connectInputSchema,
  expiryFromNow,
  openToken,
  parseTokenKey,
  sealToken
} from "../src/index.js";

const keyHex = randomBytes(32).toString("hex");

describe("token vault crypto", () => {
  it("round-trips through AES-GCM with a fresh IV per seal", () => {
    const key = parseTokenKey(keyHex);
    const first = sealToken(key, "secret-token");
    const second = sealToken(key, "secret-token");
    expect(first.iv).not.toBe(second.iv);
    expect(openToken(key, first)).toBe("secret-token");
    expect(openToken(key, second)).toBe("secret-token");
  });

  it("rejects bad keys and foreign ciphertext", () => {
    expect(() => parseTokenKey("short")).toThrow(ConnectionCryptoError);
    expect(() => parseTokenKey(undefined)).toThrow(ConnectionCryptoError);
    const key = parseTokenKey(keyHex);
    const sealed = sealToken(key, "x");
    expect(() => openToken(parseTokenKey(randomBytes(32).toString("hex")), sealed)).toThrow(ConnectionCryptoError);
    expect(() => openToken(key, { ...sealed, tag: Buffer.from("wrong").toString("base64") })).toThrow(
      ConnectionCryptoError
    );
  });

  it("validates connection input and derives status", () => {
    expect(connectInputSchema.parse({ provider: "NOTION", accessToken: "ntn_123" }).refreshToken).toBeNull();
    expect(() => connectInputSchema.parse({ provider: "DROPBOX", accessToken: "x" })).toThrow();
    expect(expiryFromNow(null)).toBeNull();
    const expiry = expiryFromNow(3600);
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBeGreaterThan(Date.now());
    expect(connectionStatusOf(null)).toBe("connected");
    expect(connectionStatusOf(new Date(Date.now() - 1_000))).toBe("expired");
    expect(connectionStatusOf(new Date(Date.now() + 3_600_000))).toBe("connected");
  });
});
