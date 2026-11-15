/**
 * Before `gh pr merge`, the security agent verifies that I asked for this
 * merge (ADR-0036, second step): the bot signed my ✅ Fusionner — the
 * finding, the pull request's address, the commit I was shown, the instant —
 * with a key it alone holds; the agent holds the public key and only
 * verifies. A request written "fusion_demandee" by any other program, moved
 * to another pull request or commit, too old, or naming a pull request of
 * another repository, is refused by name and never merged.
 *
 * The window is 30 minutes, not the operator's 15: the agent passes every
 * 15 minutes, and a tap just after a round must survive until the next one.
 */
import type { KeyObject } from "node:crypto";
import {
  ConfirmationKeyError,
  confirmPublicKeyFromEnv,
  prRepository,
  verifyMergeConfirmation,
} from "@cenacle/core";
import type { StoredFinding } from "@cenacle/journal";
import type { PrOps } from "./merge.ts";

export const MERGE_CONFIRM_MAX_MS = 30 * 60_000;
/** The Mac's clock and the bot's may differ a little; never a confirmation from further ahead. */
const AHEAD_MS = 60_000;
const NAME_WITH_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export type MergeSignRefusal = "cle_absente" | "non_signee" | "trop_ancienne" | "autre_depot";

/** The bot's public key, or null when it is missing or is not one. */
export function mergeKeyOrNull(env: NodeJS.ProcessEnv = process.env): KeyObject | null {
  try {
    return confirmPublicKeyFromEnv(env);
  } catch (error) {
    if (!(error instanceof ConfirmationKeyError)) throw error;
    return null;
  }
}

/** "owner/repo" of the project, lower case, as gh knows it from the checkout; null if unread. */
export async function ownRepository(ops: PrOps): Promise<string | null> {
  const out = await ops.run(
    ops.gh,
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    ops.root,
  );
  const name = out.stdout.trim();
  return out.code === 0 && NAME_WITH_OWNER.test(name) ? name.toLowerCase() : null;
}

export interface MergeCheck {
  readonly publicKey: KeyObject | null;
  /** The project's own repository; null when it could not be read — then nothing merges. */
  readonly repository: string | null;
  readonly now: Date;
}

/** Why this merge request is not one I signed — the refusal's name — or null when it is. */
export function mergeNotSigned(
  f: Pick<StoredFinding, "id" | "actionPrUrl" | "actionHeadSha" | "mergeSig" | "mergeConfirmedAt">,
  check: MergeCheck,
): MergeSignRefusal | null {
  if (check.publicKey === null) return "cle_absente";
  const { actionPrUrl: prUrl, actionHeadSha: headSha, mergeConfirmedAt: confirmedAt } = f;
  if (prUrl === null || headSha === null || confirmedAt === null) return "non_signee";
  const signed = verifyMergeConfirmation(
    check.publicKey,
    { findingId: f.id, prUrl, headSha, confirmedAt },
    f.mergeSig,
  );
  if (!signed) return "non_signee";
  const age = check.now.getTime() - confirmedAt.getTime();
  if (age > MERGE_CONFIRM_MAX_MS || age < -AHEAD_MS) return "trop_ancienne";
  const repository = prRepository(prUrl);
  if (check.repository === null || repository !== check.repository) return "autre_depot";
  return null;
}
