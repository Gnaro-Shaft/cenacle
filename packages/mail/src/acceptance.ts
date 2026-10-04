/**
 * Signing and checking my acceptance of a proposal (ADR-0013): what the page
 * signs at the moment I click, and what the executor checks on the row it
 * has just claimed. The key pair and the signature format are in core.
 */
import type { KeyObject } from "node:crypto";
import { draftHash, signAcceptance, verifyAcceptance } from "@cenacle/core";
import type { Proposal, SignedAcceptance } from "@cenacle/journal";

/** The page: signs the proposal's current text, decided now. */
export function signProposal(privateKey: KeyObject, p: Proposal, now: Date): SignedAcceptance {
  const draft = p.draft ?? "";
  return {
    signature: signAcceptance(privateKey, {
      id: p.id,
      mailUidValidity: p.mailUidValidity,
      mailUid: p.mailUid,
      draft,
      decidedAt: now,
    }),
    draftHash: draftHash(draft),
  };
}

/** The executor: was this exact row — this proposal, this mail, this text — accepted on the page? */
export function isAcceptedByPage(publicKey: KeyObject, p: Proposal): boolean {
  if (p.draft === null || p.decidedAt === null) return false;
  return verifyAcceptance(
    publicKey,
    {
      id: p.id,
      mailUidValidity: p.mailUidValidity,
      mailUid: p.mailUid,
      draft: p.draft,
      decidedAt: p.decidedAt,
    },
    p.acceptanceSig,
  );
}
