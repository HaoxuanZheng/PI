import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { ObjectSnapshot } from "@lifegraph/domain";
import { PublicationValidationError } from "@lifegraph/publications";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../src/index";
import { createObjectRepository } from "../src/repositories/objects";
import {
  createPublicReadRepository,
  createPublicationRepository,
  PublicationStateError
} from "../src/repositories/publications";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const client = testDatabaseUrl ? createDatabaseClient(testDatabaseUrl) : null;

const handleFor = (id: string) => `u${id.replaceAll("-", "").slice(0, 12)}`;

const projectSnapshot: ObjectSnapshot = {
  schemaVersion: 1,
  type: "PROJECT",
  title: "Personal Internet",
  summary: "A private-by-default Personal Graph",
  body: { format: "plain_text", content: "public body text" },
  tags: ["ai"],
  // Private detail that must never appear in any public response.
  customFields: { privateNotes: "investor contact bob@secret.example", source: { provider: "NOTION", externalId: "n1" } }
};

integration("publication repository", () => {
  beforeAll(async () => {
    if (!client) return;
    await migrate(client.db, { migrationsFolder: "packages/db/migrations" });
  }, 30_000);

  afterAll(async () => client?.close());

  it("publishes authorized projections and never exposes private data", async () => {
    if (!client) throw new Error("TEST_DATABASE_URL is required");
    const objectsRepository = createObjectRepository(client);
    const publicationsRepository = createPublicationRepository(client);
    const publicRead = createPublicReadRepository(client);

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const handleA = handleFor(ownerA);
    await objectsRepository.provisionUser({ id: ownerA, username: handleA, email: "a@example.com" });
    await objectsRepository.provisionUser({ id: ownerB, username: handleFor(ownerB), email: "b@example.com" });

    const project = await objectsRepository.create(ownerA, { snapshot: projectSnapshot, visibility: "PRIVATE" });

    // Preview is exactly what publishing stores.
    const preview = await publicationsRepository.previewObject(ownerA, project.object.id, ["title", "summary", "body", "tags"]);
    expect(preview.publicSnapshot.object.title).toBe("Personal Internet");
    expect(JSON.stringify(preview)).not.toContain("bob@secret.example");

    // A stale expected revision is refused, so a concurrent edit cannot be published unseen.
    await expect(publicationsRepository.publishObject(ownerA, {
      sourceObjectId: project.object.id, slug: "personal-internet", fields: ["title"], expectedRevisionId: randomUUID(), confirm: true
    })).rejects.toThrow(PublicationStateError);

    const published = await publicationsRepository.publishObject(ownerA, {
      sourceObjectId: project.object.id,
      slug: "personal-internet",
      fields: ["title", "summary", "body", "tags"],
      expectedRevisionId: project.currentRevision.id,
      confirm: true
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.handle).toBe(handleA);

    // The anonymous read path returns the projection and nothing else.
    const anonymous = await publicRead.object(handleA, "personal-internet");
    expect(anonymous).not.toBeNull();
    const serialised = JSON.stringify(anonymous);
    for (const secret of ["bob@secret.example", "privateNotes", "NOTION", "n1", "a@example.com", ownerA]) {
      expect(serialised).not.toContain(secret);
    }

    // A person record can never be published, because it carries contact detail.
    const contact = await objectsRepository.create(ownerA, {
      snapshot: {
        schemaVersion: 1, type: "PERSON", title: "Alex Chen", tags: [],
        customFields: { person: { displayName: "Alex Chen", organization: null, role: null, emails: ["alex@example.com"], phones: [], interests: [] } }
      },
      visibility: "PRIVATE"
    });
    await expect(publicationsRepository.publishObject(ownerA, {
      sourceObjectId: contact.object.id, slug: "alex", fields: ["title"], expectedRevisionId: contact.currentRevision.id, confirm: true
    })).rejects.toThrow(PublicationValidationError);

    // A profile is a view configuration over the owner's own objects.
    const profile = await publicationsRepository.publishProfile(ownerA, {
      publicationType: "PROFILE",
      displayName: "Haoxuan",
      headline: "Building a Personal Internet",
      sections: [{ type: "PROJECT", heading: "Projects", sourceObjectIds: [project.object.id], fields: ["title", "summary"] }],
      confirm: true
    });
    expect(profile.publicationType).toBe("PROFILE");

    const publicProfile = await publicRead.profile(handleA, "PROFILE");
    expect(publicProfile?.publicSnapshot.kind).toBe("PROFILE");
    expect(JSON.stringify(publicProfile)).not.toContain("bob@secret.example");
    expect(await publicRead.profile(handleA, "PROFESSIONAL")).toBeNull();
    expect((await publicRead.objectsFor(handleA)).map((page) => page.slug)).toEqual(["personal-internet"]);

    // A profile cannot reference another user's object.
    const foreign = await objectsRepository.create(ownerB, { snapshot: projectSnapshot, visibility: "PRIVATE" });
    await expect(publicationsRepository.publishProfile(ownerA, {
      publicationType: "PROFESSIONAL",
      displayName: "Haoxuan",
      headline: null,
      sections: [{ type: "PROJECT", heading: "Projects", sourceObjectIds: [foreign.object.id], fields: ["title"] }],
      confirm: true
    })).rejects.toThrow();

    // Editing the source does not change what is already public, but is reported as stale.
    await objectsRepository.update(ownerA, project.object.id, {
      expectedRevisionId: project.currentRevision.id,
      snapshot: { ...projectSnapshot, title: "Renamed after publishing" }
    });
    const stillPublic = await publicRead.object(handleA, "personal-internet");
    expect(stillPublic?.publicSnapshot.kind === "OBJECT" && stillPublic.publicSnapshot.object.title).toBe("Personal Internet");
    expect((await publicationsRepository.staleness(ownerA)).map((row) => row.slug)).toContain("personal-internet");

    // Unpublishing takes effect immediately.
    await publicationsRepository.unpublish(ownerA, published.id);
    expect(await publicRead.object(handleA, "personal-internet")).toBeNull();
    await expect(publicationsRepository.unpublish(ownerA, published.id)).rejects.toThrow(PublicationStateError);
    // Another user cannot unpublish someone else's page.
    await expect(publicationsRepository.unpublish(ownerB, profile.id)).rejects.toThrow();

    // Deleting a published object stops serving it, without an explicit unpublish.
    const republished = await publicationsRepository.publishObject(ownerA, {
      sourceObjectId: project.object.id,
      slug: "personal-internet",
      fields: ["title"],
      expectedRevisionId: (await objectsRepository.get(ownerA, project.object.id)).currentRevision.id,
      confirm: true
    });
    expect(republished.status).toBe("PUBLISHED");
    expect(await publicRead.object(handleA, "personal-internet")).not.toBeNull();

    const current = await objectsRepository.get(ownerA, project.object.id);
    await objectsRepository.softDelete(ownerA, project.object.id, current.currentRevision.id);
    expect(await publicRead.object(handleA, "personal-internet")).toBeNull();

    // An unknown handle or slug is simply absent.
    expect(await publicRead.object(handleA, "does-not-exist")).toBeNull();
    expect(await publicRead.profile("nobodyhere", "PROFILE")).toBeNull();
  }, 60_000);
});
