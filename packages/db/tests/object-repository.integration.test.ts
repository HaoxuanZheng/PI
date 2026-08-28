import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { createObjectRepository, RevisionConflictError } from "../src/repositories/objects";
import { createPermissionRepository, PermissionDeniedError } from "../src/repositories/permissions";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

integration("object + revision repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("creates, updates, restores, and isolates an object", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const repository = createObjectRepository(client);
    const permissions = createPermissionRepository(client);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await repository.provisionUser({ id: ownerA, username: `u${ownerA.replaceAll("-", "").slice(0, 12)}`, email: null });
    await repository.provisionUser({ id: ownerB, username: `u${ownerB.replaceAll("-", "").slice(0, 12)}`, email: null });

    const created = await repository.create(ownerA, {
      snapshot: {
        schemaVersion: 1,
        type: "NOTE",
        title: "First title",
        body: { format: "plain_text", content: "First body" },
        tags: [],
        customFields: {}
      },
      visibility: "PRIVATE"
    });

    const crossUserRows = await client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${ownerB}, true)`;
      return sql`select id from objects where id = ${created.object.id}`;
    });
    expect(crossUserRows).toHaveLength(0);
    await expect(repository.get(ownerB, created.object.id)).rejects.toBeInstanceOf(PermissionDeniedError);

    await permissions.grant(ownerA, created.object.id, {
      principalType: "USER",
      principalId: ownerB,
      capability: "READ"
    }, "test-read-grant");
    expect((await repository.get(ownerB, created.object.id)).object.id).toBe(created.object.id);
    await expect(repository.update(ownerB, created.object.id, {
      expectedRevisionId: created.currentRevision.id,
      snapshot: created.currentRevision.snapshot
    })).rejects.toBeInstanceOf(PermissionDeniedError);

    const editGrant = await permissions.grant(ownerA, created.object.id, {
      principalType: "USER",
      principalId: ownerB,
      capability: "EDIT"
    }, "test-edit-grant");

    const updated = await repository.update(ownerB, created.object.id, {
      expectedRevisionId: created.currentRevision.id,
      snapshot: {
        ...created.currentRevision.snapshot,
        title: "Second title"
      }
    });
    expect(updated.currentRevision.previousRevisionId).toBe(created.currentRevision.id);

    const noOp = await repository.update(ownerB, created.object.id, {
      expectedRevisionId: updated.currentRevision.id,
      snapshot: updated.currentRevision.snapshot
    });
    expect(noOp.currentRevision.id).toBe(updated.currentRevision.id);

    await expect(repository.update(ownerA, created.object.id, {
      expectedRevisionId: created.currentRevision.id,
      snapshot: updated.currentRevision.snapshot
    })).rejects.toBeInstanceOf(RevisionConflictError);

    const restored = await repository.restore(ownerA, created.object.id, {
      revisionId: created.currentRevision.id,
      expectedRevisionId: updated.currentRevision.id
    });
    expect(restored.currentRevision.changeType).toBe("RESTORE");
    expect(restored.currentRevision.snapshot.title).toBe("First title");
    expect(await repository.revisions(ownerA, created.object.id)).toHaveLength(3);
    expect(await permissions.list(ownerA, created.object.id)).toHaveLength(2);
    await expect(permissions.list(ownerB, created.object.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await permissions.audit(ownerA, created.object.id)).toHaveLength(3);

    await expect(client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${ownerB}, true)`;
      await sql`insert into permissions (owner_id, resource_type, resource_id, principal_type, principal_id, capability)
        values (${ownerB}, 'OBJECT', ${created.object.id}, 'USER', ${ownerB}, 'ADMIN')`;
    })).rejects.toThrow();

    await permissions.revoke(ownerA, created.object.id, editGrant.id, "test-edit-revoke");
    await expect(repository.update(ownerB, created.object.id, {
      expectedRevisionId: restored.currentRevision.id,
      snapshot: restored.currentRevision.snapshot
    })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await permissions.list(ownerA, created.object.id)).toHaveLength(1);
    expect(await permissions.audit(ownerA, created.object.id)).toHaveLength(4);

    await expect(client.sql.begin(async (sql) => {
      await sql`select set_config('app.current_user_id', ${ownerA}, true)`;
      await sql`update object_revisions set change_type = 'UPDATE' where id = ${restored.currentRevision.id}`;
    })).rejects.toThrow(/immutable/);
  });
});
