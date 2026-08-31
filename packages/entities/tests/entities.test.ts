import type { PersonProfile } from "@lifegraph/domain";
import { describe, expect, it } from "vitest";
import {
  findMergeCandidates,
  mergePersonProfiles,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  personSignals,
  scorePersonMatch
} from "../src/index";

function person(overrides: Partial<PersonProfile> = {}): PersonProfile {
  return {
    displayName: "Alex Chen",
    organization: "Example Labs",
    role: null,
    emails: [],
    phones: [],
    interests: [],
    ...overrides
  };
}

const signals = (profile: PersonProfile, source: { provider: string; externalId: string } | null = null) =>
  personSignals(profile, source);

describe("normalisation", () => {
  it("accepts a well-formed email and rejects malformed input", () => {
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("alex@localhost")).toBeNull();
  });

  it("compares phones on their last nine digits", () => {
    expect(normalizePhone("+1 (212) 555-0147")).toBe("212555 0147".replace(/\D/g, "").slice(-9));
    expect(normalizePhone("+1 212 555 0147")).toBe(normalizePhone("212-555-0147"));
    expect(normalizePhone("1234")).toBeNull();
  });

  it("is insensitive to case, accents, and punctuation in names", () => {
    expect(normalizeName("José  Álvarez-Ruiz")).toBe("jose alvarez ruiz");
    expect(normalizeName("Alex Chen")).toBe(normalizeName("ALEX  CHEN!"));
    expect(normalizeName("   ")).toBeNull();
  });
});

describe("deterministic scoring", () => {
  it("treats a shared email as a high-confidence signal", () => {
    const match = scorePersonMatch(
      signals(person({ emails: ["alex@example.com"] })),
      signals(person({ displayName: "A. Chen", organization: null, emails: ["ALEX@example.com"] }))
    );
    expect(match.signals).toContain("EMAIL");
    expect(match.confidence).toBe("HIGH");
    expect(match.shouldPropose).toBe(true);
  });

  it("matches a phone written with and without a country code", () => {
    const match = scorePersonMatch(
      signals(person({ displayName: "Alex", organization: null, phones: ["+1 212 555 0147"] })),
      signals(person({ displayName: "Chen", organization: null, phones: ["(212) 555-0147"] }))
    );
    expect(match.signals).toContain("PHONE");
    expect(match.confidence).toBe("HIGH");
  });

  it("proposes on name plus organisation, but only reviews on name alone", () => {
    const withOrg = scorePersonMatch(signals(person()), signals(person()));
    expect(withOrg.signals).toContain("NAME_AND_ORGANIZATION");
    expect(withOrg.shouldPropose).toBe(true);

    const nameOnly = scorePersonMatch(
      signals(person({ organization: null })),
      signals(person({ organization: null }))
    );
    expect(nameOnly.signals).toEqual(["NAME"]);
    expect(nameOnly.confidence).toBe("LOW");
    expect(nameOnly.shouldPropose).toBe(false);
  });

  it("does not let weak agreements accumulate into a strong score", () => {
    const match = scorePersonMatch(signals(person()), signals(person()));
    // NAME_AND_ORGANIZATION is the strongest signal present, so the score is exactly its weight.
    expect(match.score).toBe(0.6);
    expect(match.confidence).toBe("MEDIUM");
  });

  it("finds nothing in common between genuinely different people", () => {
    const match = scorePersonMatch(
      signals(person({ displayName: "Alex Chen", emails: ["alex@example.com"] })),
      signals(person({ displayName: "Sam Patel", organization: "Other Co", emails: ["sam@other.com"] }))
    );
    expect(match.signals).toEqual([]);
    expect(match.score).toBe(0);
    expect(match.shouldPropose).toBe(false);
  });

  it("never reports a merge as automatic, even on an exact provider id", () => {
    const source = { provider: "GOOGLE_CONTACTS", externalId: "people/c1" };
    const match = scorePersonMatch(signals(person(), source), signals(person(), source));
    expect(match.signals).toContain("PROVIDER_ID");
    expect(match.score).toBe(1);
    // The strongest possible signal still only yields a proposal for a human to decide.
    expect(Object.keys(match)).not.toContain("autoMerge");
    expect(match.shouldPropose).toBe(true);
  });
});

describe("candidate generation", () => {
  const subject = { objectId: "bbbb", signals: signals(person({ emails: ["alex@example.com"] })) };

  it("orders each pair stably and ignores itself", () => {
    const candidates = findMergeCandidates(subject, [
      { objectId: "aaaa", signals: signals(person({ emails: ["alex@example.com"] })) },
      { objectId: "bbbb", signals: subject.signals }
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ leftObjectId: "aaaa", rightObjectId: "bbbb" });
  });

  it("returns the strongest proposal first and omits noise", () => {
    const candidates = findMergeCandidates(subject, [
      // Same name and organisation: a proposal, but weaker than a shared email.
      { objectId: "cccc", signals: signals(person()) },
      { objectId: "dddd", signals: signals(person({ emails: ["alex@example.com"] })) },
      // A different person entirely.
      { objectId: "eeee", signals: signals(person({ displayName: "Someone Else", organization: "Nowhere" })) },
      // Same name but no organisation to corroborate it, so name-only noise.
      { objectId: "ffff", signals: signals(person({ organization: null })) }
    ]);
    expect(candidates.map((candidate) => candidate.rightObjectId === "bbbb" ? candidate.leftObjectId : candidate.rightObjectId))
      .toEqual(["dddd", "cccc"]);
    expect(candidates[0]?.match.signals).toContain("EMAIL");
    expect(candidates[1]?.match.signals).toContain("NAME_AND_ORGANIZATION");
  });
});

describe("profile merge", () => {
  it("keeps the target authoritative and unions multi-valued fields", () => {
    const merged = mergePersonProfiles(
      person({ role: "Engineer", emails: ["alex@example.com"], interests: ["AI"] }),
      person({ displayName: "A. Chen", organization: "Ignored Co", role: "Founder", emails: ["alex@other.com"], phones: ["212-555-0147"], interests: ["AI", "Education"] })
    );
    expect(merged.displayName).toBe("Alex Chen");
    expect(merged.role).toBe("Engineer");
    expect(merged.organization).toBe("Example Labs");
    expect(merged.emails).toEqual(["alex@example.com", "alex@other.com"]);
    expect(merged.phones).toEqual(["212-555-0147"]);
    expect(merged.interests).toEqual(["AI", "Education"]);
  });

  it("fills a missing target scalar from the source rather than discarding it", () => {
    const merged = mergePersonProfiles(person({ organization: null, role: null }), person({ organization: "Example Labs", role: "Engineer" }));
    expect(merged.organization).toBe("Example Labs");
    expect(merged.role).toBe("Engineer");
  });
});
