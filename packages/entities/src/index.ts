import type { PersonProfile } from "@lifegraph/domain";
import { z } from "zod";

export const mergeDecisionSchema = z.enum(["MERGE", "SEPARATE"]);
export type MergeDecision = z.infer<typeof mergeDecisionSchema>;

export type MatchSignal = "PROVIDER_ID" | "EMAIL" | "PHONE" | "NAME_AND_ORGANIZATION" | "NAME";
export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * Deterministic signal weights. Nothing here ever merges on its own: resolution produces a
 * reviewable proposal, and a person decides. AI is deliberately absent from this path.
 */
const signalWeights: Record<MatchSignal, number> = {
  PROVIDER_ID: 1,
  EMAIL: 0.9,
  PHONE: 0.8,
  NAME_AND_ORGANIZATION: 0.6,
  NAME: 0.35
};

/** Lowercase and trim only. Provider-specific aliasing (dots, `+` tags) is intentionally not applied. */
export function normalizeEmail(value: string) {
  const trimmed = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Reduces a phone number to comparable digits. Matching uses the last nine, so a number stored
 * with a country code still matches the same number stored without one.
 */
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/** Case, accent, and punctuation insensitive name key. */
export function normalizeName(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export type PersonSignals = {
  emails: Set<string>;
  phones: Set<string>;
  name: string | null;
  organization: string | null;
  source: { provider: string; externalId: string } | null;
};

export function personSignals(
  profile: PersonProfile,
  source: { provider: string; externalId: string } | null = null
): PersonSignals {
  return {
    emails: new Set(profile.emails.map(normalizeEmail).filter((value): value is string => value !== null)),
    phones: new Set(profile.phones.map(normalizePhone).filter((value): value is string => value !== null)),
    name: normalizeName(profile.displayName),
    organization: profile.organization ? normalizeName(profile.organization) : null,
    source
  };
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export type PersonMatch = {
  score: number;
  signals: MatchSignal[];
  confidence: MatchConfidence;
  shouldPropose: boolean;
};

/**
 * Scores two candidate people using deterministic signals only.
 *
 * `shouldPropose` never implies a merge. Even a PROVIDER_ID match returns a proposal, because two
 * records that agree on one identifier can still be different people in the user's own model.
 */
export function scorePersonMatch(left: PersonSignals, right: PersonSignals): PersonMatch {
  const signals: MatchSignal[] = [];

  if (left.source && right.source && left.source.provider === right.source.provider && left.source.externalId === right.source.externalId) {
    signals.push("PROVIDER_ID");
  }
  if (intersects(left.emails, right.emails)) signals.push("EMAIL");
  if (intersects(left.phones, right.phones)) signals.push("PHONE");

  const sameName = left.name !== null && left.name === right.name;
  if (sameName && left.organization !== null && left.organization === right.organization) {
    signals.push("NAME_AND_ORGANIZATION");
  } else if (sameName) {
    signals.push("NAME");
  }

  // Strongest signal wins rather than summing, so three weak agreements cannot imitate an identifier.
  const score = signals.reduce((highest, signal) => Math.max(highest, signalWeights[signal]), 0);
  const confidence: MatchConfidence = score >= signalWeights.PHONE ? "HIGH" : score >= signalWeights.NAME_AND_ORGANIZATION ? "MEDIUM" : "LOW";

  return {
    score,
    signals,
    confidence,
    // A shared first name alone is noise; it is recorded but never surfaced as a duplicate.
    shouldPropose: score >= signalWeights.NAME_AND_ORGANIZATION
  };
}

export type PersonRecord = { objectId: string; signals: PersonSignals };
export type MergeCandidate = { leftObjectId: string; rightObjectId: string; match: PersonMatch };

/**
 * Compares one person against existing people and returns proposals worth a human decision,
 * strongest first. Comparison is in-memory and quadratic in the worst case, which is acceptable at
 * MVP scale; a blocking index on email and phone keys is the natural next step.
 */
export function findMergeCandidates(subject: PersonRecord, existing: readonly PersonRecord[]): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  for (const other of existing) {
    if (other.objectId === subject.objectId) continue;
    const match = scorePersonMatch(subject.signals, other.signals);
    if (!match.shouldPropose) continue;
    // Ordering the pair makes a candidate stable regardless of which side was imported first.
    const [leftObjectId, rightObjectId] = subject.objectId < other.objectId
      ? [subject.objectId, other.objectId]
      : [other.objectId, subject.objectId];
    candidates.push({ leftObjectId, rightObjectId, match });
  }
  return candidates.sort((a, b) => b.match.score - a.match.score);
}

/**
 * Combines two person profiles for a merge, keeping the target as authoritative for scalar fields
 * and unioning the multi-valued ones. No source value is silently discarded.
 */
export function mergePersonProfiles(target: PersonProfile, source: PersonProfile): PersonProfile {
  const union = (left: readonly string[], right: readonly string[]) => Array.from(new Set([...left, ...right]));
  return {
    displayName: target.displayName,
    organization: target.organization ?? source.organization,
    role: target.role ?? source.role,
    emails: union(target.emails, source.emails),
    phones: union(target.phones, source.phones),
    interests: union(target.interests, source.interests)
  };
}
