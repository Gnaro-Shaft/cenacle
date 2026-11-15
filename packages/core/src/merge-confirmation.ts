/**
 * My ✅ Fusionner under the security agent's pull request, signed by the bot
 * (ADR-0036, second step). Same key and same rule as an action on a server:
 * the bot alone signs, the security agent only verifies before `gh pr merge`.
 * The signature covers the finding, the pull request's address, the exact
 * commit I was shown and the instant: a request written "merge" by any other
 * program, moved to another pull request — of this repository or another —
 * or to another commit, is never merged.
 */
import type { KeyObject } from "node:crypto";
import { ConfirmationFieldError } from "./confirmation.ts";
import { signMessage, verifyMessage } from "./ed25519.ts";

const MERGE_VERSION = "cenacle-merge-v1";
/** A GitHub pull request, and nothing around it: no query, no fragment, no trailing part. */
const PR_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9]\d{0,8})$/;
/** A full commit, as GitHub gives it: never a prefix, which could name two. */
const SHA = /^[0-9a-f]{40}$/;

/** What the signature of a merge covers. */
export interface MergeConfirmation {
  /** The finding my button was under. */
  readonly findingId: number;
  readonly prUrl: string;
  /** The commit the CI tested and the message showed. */
  readonly headSha: string;
  readonly confirmedAt: Date;
}

/** "owner/repo" of a pull request's address, lower case, or null when it is not one. */
export function prRepository(url: string): string | null {
  if (typeof url !== "string") return null;
  const m = PR_URL.exec(url);
  if (m === null || m[2] === "." || m[2] === "..") return null;
  return `${m[1]}/${m[2]}`.toLowerCase();
}

export function mergeConfirmationMessage(f: MergeConfirmation): string {
  if (!Number.isSafeInteger(f.findingId) || f.findingId < 1) {
    throw new ConfirmationFieldError("the finding is not a row number");
  }
  if (prRepository(f.prUrl) === null) {
    throw new ConfirmationFieldError("the pull request's address is not one");
  }
  if (typeof f.headSha !== "string" || !SHA.test(f.headSha)) {
    throw new ConfirmationFieldError("the commit is not a full commit");
  }
  if (!(f.confirmedAt instanceof Date) || Number.isNaN(f.confirmedAt.getTime())) {
    throw new ConfirmationFieldError("the instant of the confirmation is not a date");
  }
  return [MERGE_VERSION, String(f.findingId), f.prUrl, f.headSha, f.confirmedAt.toISOString()].join(
    "\n",
  );
}

/** Throws a ConfirmationFieldError rather than sign a field it cannot pin down. */
export function signMergeConfirmation(privateKey: KeyObject, f: MergeConfirmation): string {
  return signMessage(privateKey, mergeConfirmationMessage(f));
}

/** Never throws: anything but a valid signature of these exact fields is false. */
export function verifyMergeConfirmation(
  publicKey: KeyObject,
  f: MergeConfirmation,
  signature: string | null,
): boolean {
  try {
    return verifyMessage(publicKey, mergeConfirmationMessage(f), signature);
  } catch {
    return false;
  }
}
