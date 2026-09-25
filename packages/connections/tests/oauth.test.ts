import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeGoogleCode,
  googleAuthUrl,
  googleScopes,
  isGoogleProvider,
  refreshGoogleToken
} from "../src/index.js";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("google oauth protocol", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a consent URL with read-only scopes and offline access", () => {
    const url = new URL(
      googleAuthUrl({ clientId: "cid", redirectUri: "https://app.example/cb", provider: "GOOGLE_DRIVE", state: "s" })
    );
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("s");
    expect(googleScopes("GOOGLE_CONTACTS")).toEqual(["https://www.googleapis.com/auth/contacts.readonly"]);
    expect(isGoogleProvider("GOOGLE_DRIVE")).toBe(true);
    expect(isGoogleProvider("NOTION")).toBe(false);
  });

  it("exchanges codes and refreshes through the token endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await exchangeGoogleCode({ clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/cb", code: "code" });
    expect(tokens.access_token).toBe("a");
    expect(tokens.refresh_token).toBe("r");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=authorization_code");

    const rotated = await refreshGoogleToken({ clientId: "cid", clientSecret: "sec", refreshToken: "r" });
    expect(rotated.access_token).toBe("a");
  });

  it("rejects provider failures and malformed token sets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid_grant" }, false)));
    await expect(
      exchangeGoogleCode({ clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/cb", code: "bad" })
    ).rejects.toThrowError(/exchange failed/);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ access_token: 42 })));
    await expect(refreshGoogleToken({ clientId: "cid", clientSecret: "sec", refreshToken: "r" })).rejects.toThrow();
  });
});
