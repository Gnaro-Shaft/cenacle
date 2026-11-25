/**
 * My acceptance of a demand to the house, signed by the page (ADR-0048, the
 * ADR-0013 way). The same key pair as the drafts' acceptance — the page's
 * server alone holds the private key — under another message, so that a
 * signature of a draft can never pass for a demand, nor the reverse.
 *
 * The signature covers the demand's number, its origin, its folder, the
 * SHA-256 of its exact text and the instant of my decision: a demand accepted
 * without the page, or whose text changed afterwards, is never handed over.
 */
import { createHash, type KeyObject } from "node:crypto";
import { signMessage, verifyMessage } from "./ed25519.ts";

const VERSION = "cenacle-liaison-v1";

/** What the signature covers. */
export interface LiaisonAcceptation {
  readonly id: number;
  readonly origine: string;
  readonly dossier: string;
  readonly titre: string;
  readonly description: string;
  readonly decideLe: Date;
}

/** SHA-256 of the title, a line break and the description (a title is one line). */
export const texteHash = (titre: string, description: string): string =>
  createHash("sha256").update(`${titre}\n${description}`, "utf8").digest("hex");

export function liaisonMessage(a: LiaisonAcceptation): string {
  return [
    VERSION,
    String(a.id),
    a.origine,
    a.dossier,
    texteHash(a.titre, a.description),
    a.decideLe.toISOString(),
  ].join("\n");
}

/** The page's server only: with the private key of the acceptance (acceptance.ts). */
export function signerLiaison(privateKey: KeyObject, a: LiaisonAcceptation): string {
  return signMessage(privateKey, liaisonMessage(a));
}

/** Never throws: anything but a valid signature of these exact fields is false. */
export function verifierLiaison(
  publicKey: KeyObject,
  a: LiaisonAcceptation,
  signature: string | null,
): boolean {
  try {
    if (!Number.isSafeInteger(a.id) || a.id <= 0) return false;
    if (Number.isNaN(a.decideLe.getTime())) return false;
    return verifyMessage(publicKey, liaisonMessage(a), signature);
  } catch {
    return false;
  }
}
