import { z } from "zod";

export const capabilitySchema = z.enum(["READ", "COMMENT", "EDIT", "COLLABORATE", "SHARE", "ADMIN"]);
export const principalTypeSchema = z.enum(["USER", "CONNECTION", "GROUP", "LINK", "PUBLIC", "SYSTEM_AI"]);
export const resourceTypeSchema = z.enum(["OBJECT"]);

export const grantPermissionInputSchema = z.object({
  principalType: principalTypeSchema,
  principalId: z.string().trim().min(1).max(200).nullable(),
  capability: capabilitySchema
}).superRefine((value, context) => {
  if (value.principalType === "PUBLIC" && value.principalId !== null) {
    context.addIssue({ code: "custom", path: ["principalId"], message: "PUBLIC grants cannot have a principalId" });
  }
  if (value.principalType !== "PUBLIC" && value.principalId === null) {
    context.addIssue({ code: "custom", path: ["principalId"], message: "This principal type requires a principalId" });
  }
});

export type Capability = z.infer<typeof capabilitySchema>;
export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type GrantPermissionInput = z.infer<typeof grantPermissionInputSchema>;

export type PermissionGrant = {
  principalType: PrincipalType;
  principalId: string | null;
  capability: Capability;
};

export type PermissionDecision = {
  allowed: boolean;
  reason: "OWNER" | "EXPLICIT_GRANT" | "PUBLIC_GRANT" | "DENIED";
  fieldPolicy: { default: "PRIVATE"; fields: Record<string, "PRIVATE" | "PUBLIC" | "CONNECTIONS"> };
};

const impliedCapabilities: Record<Capability, ReadonlySet<Capability>> = {
  READ: new Set(["READ"]),
  COMMENT: new Set(["READ", "COMMENT"]),
  EDIT: new Set(["READ", "EDIT"]),
  COLLABORATE: new Set(["READ", "COMMENT", "EDIT", "COLLABORATE"]),
  SHARE: new Set(["READ", "SHARE"]),
  ADMIN: new Set(["READ", "COMMENT", "EDIT", "COLLABORATE", "SHARE", "ADMIN"])
};

export function decidePermission(input: {
  actorUserId: string | null;
  action: Capability;
  resourceOwnerId: string;
  grants: readonly PermissionGrant[];
  allowPublicGrants?: boolean;
}): PermissionDecision {
  const fieldPolicy = { default: "PRIVATE" as const, fields: {} };
  if (input.actorUserId === input.resourceOwnerId) return { allowed: true, reason: "OWNER", fieldPolicy };

  for (const grant of input.grants) {
    const principalMatches = grant.principalType === "PUBLIC"
      ? input.allowPublicGrants === true
      : grant.principalType === "USER" && grant.principalId === input.actorUserId;
    if (principalMatches && impliedCapabilities[grant.capability].has(input.action)) {
      return {
        allowed: true,
        reason: grant.principalType === "PUBLIC" ? "PUBLIC_GRANT" : "EXPLICIT_GRANT",
        fieldPolicy
      };
    }
  }
  return { allowed: false, reason: "DENIED", fieldPolicy };
}
