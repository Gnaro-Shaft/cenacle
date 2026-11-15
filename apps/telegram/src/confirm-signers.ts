/**
 * The bot's signature of my confirmations (ADR-0036): an action on a server,
 * a maintenance plan with its steps, or the merge of a pull request. The bot alone holds the private key
 * (.env.bot); the operator verifies with the public one before acting.
 *
 * Without the key the bot still answers and chats: it confirms nothing, and
 * each tap on ✅ says why. A row that cannot be signed is never confirmed.
 */
import {
  ConfirmationFieldError,
  ConfirmationKeyError,
  confirmPrivateKeyFromEnv,
  type MergeConfirmation,
  signActionConfirmation,
  signMergeConfirmation,
  signPlanConfirmation,
} from "@cenacle/core";
import {
  actionConfirmationOf,
  planConfirmationOf,
  type StoredPlan,
  type StoredServerAction,
} from "@cenacle/journal";

export interface ConfirmSigners {
  /** Null without the key: no action can be confirmed. */
  readonly signAction: ((confirmed: StoredServerAction) => string) | null;
  /** Null without the key: no plan can be confirmed. */
  readonly signPlan: ((confirmed: StoredPlan) => string) | null;
  /** Null without the key: no merge can be asked (ADR-0036, second step). */
  readonly signMerge: ((confirmed: MergeConfirmation) => string) | null;
  /** Why there is no key — a variable's name and what to run, never a value; null when there is one. */
  readonly problem: string | null;
}

export function confirmSigners(env: NodeJS.ProcessEnv = process.env): ConfirmSigners {
  let key: ReturnType<typeof confirmPrivateKeyFromEnv>;
  try {
    key = confirmPrivateKeyFromEnv(env);
  } catch (error) {
    if (!(error instanceof ConfirmationKeyError)) throw error;
    return { signAction: null, signPlan: null, signMerge: null, problem: error.message };
  }
  return {
    signAction: (confirmed) => {
      const fields = actionConfirmationOf(confirmed);
      if (fields === null) {
        throw new ConfirmationFieldError("this row carries no confirmation of its own");
      }
      return signActionConfirmation(key, fields);
    },
    signPlan: (confirmed) => {
      const fields = planConfirmationOf(confirmed);
      if (fields === null) throw new ConfirmationFieldError("this plan is not confirmed");
      return signPlanConfirmation(key, fields);
    },
    signMerge: (confirmed) => signMergeConfirmation(key, confirmed),
    problem: null,
  };
}
