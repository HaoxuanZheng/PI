import { describe, expect, it } from "vitest";
import type { AuthService } from "../src/index";

function exerciseContract(service: AuthService) {
  return Promise.all([
    service.currentUser(),
    service.signInWithPassword("person@example.com", "password"),
    service.signUpWithPassword("person@example.com", "password")
  ]);
}

describe("AuthService contract", () => {
  it("is provider-neutral and supports a null session", async () => {
    const service: AuthService = {
      currentUser: async () => null,
      signInWithPassword: async () => ({ ok: true, user: { id: "user-1", email: "person@example.com" } }),
      signUpWithPassword: async () => ({ ok: true, user: { id: "user-1", email: "person@example.com" } }),
      confirmEmail: async () => ({ ok: true, user: { id: "user-1", email: "person@example.com" } }),
      signOut: async () => undefined
    };

    const [currentUser, signIn, signUp] = await exerciseContract(service);
    expect(currentUser).toBeNull();
    expect(signIn.ok).toBe(true);
    expect(signUp.ok).toBe(true);
  });
});
