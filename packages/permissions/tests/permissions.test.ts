import { describe, expect, it } from "vitest";
import { decidePermission, grantPermissionInputSchema } from "../src/index";

describe("permission decisions", () => {
  it("allows every owner capability", () => {
    expect(decidePermission({ actorUserId: "owner", action: "ADMIN", resourceOwnerId: "owner", grants: [] })).toMatchObject({ allowed: true, reason: "OWNER" });
  });

  it("lets EDIT imply READ but not SHARE", () => {
    const grants = [{ principalType: "USER", principalId: "member", capability: "EDIT" }] as const;
    expect(decidePermission({ actorUserId: "member", action: "READ", resourceOwnerId: "owner", grants }).allowed).toBe(true);
    expect(decidePermission({ actorUserId: "member", action: "SHARE", resourceOwnerId: "owner", grants }).allowed).toBe(false);
  });

  it("denies unrelated users", () => {
    expect(decidePermission({ actorUserId: "stranger", action: "READ", resourceOwnerId: "owner", grants: [] })).toMatchObject({ allowed: false, reason: "DENIED" });
  });

  it("does not expose canonical objects through public grants", () => {
    const grants = [{ principalType: "PUBLIC", principalId: null, capability: "READ" }] as const;
    expect(decidePermission({ actorUserId: null, action: "READ", resourceOwnerId: "owner", grants }).allowed).toBe(false);
  });

  it("validates principal identifiers", () => {
    expect(grantPermissionInputSchema.safeParse({ principalType: "PUBLIC", principalId: "someone", capability: "READ" }).success).toBe(false);
    expect(grantPermissionInputSchema.safeParse({ principalType: "USER", principalId: null, capability: "READ" }).success).toBe(false);
  });
});
