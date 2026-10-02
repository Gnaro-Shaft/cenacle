/**
 * One pass of model sorting by Iris: journaled as counts, visible on her box.
 *
 * If the local model does not answer (the Mac sleeps, LM Studio is closed),
 * Iris waits: the pass stops, the mails not yet sorted stay where they are,
 * and nothing is sent anywhere else (ADR-0003).
 */
import type { Category, MailForModel } from "@cenacle/core";
import type { Journal } from "@cenacle/journal";
import { type Classification, type ClassifyOptions, classifyMail } from "./classify.ts";
import { ModelUnavailableError } from "./iris.ts";

const AGENT = "iris";

export interface ModelSort {
  readonly classified: readonly Classification[];
  /** Mails left unsorted because the model stopped answering. */
  readonly waiting: number;
  readonly counts: Readonly<Record<Category, number>> & { readonly invalid: number };
  readonly durationMs: number;
}

export interface SortByModelDeps extends ClassifyOptions {
  readonly journal: Journal;
  /** Remembers each decision as soon as it is made (so a later pass never redoes it). */
  readonly onClassified?: (result: Classification) => Promise<void>;
  readonly classify?: typeof classifyMail;
}

export async function sortByModel(
  mails: readonly MailForModel[],
  deps: SortByModelDeps,
): Promise<ModelSort> {
  const { journal, classify = classifyMail } = deps;
  const counts = { clients_prospects: 0, administratif: 0, bruit: 0, a_trier: 0, invalid: 0 };
  const classified: Classification[] = [];
  const started = Date.now();
  await journal.append({
    agent: AGENT,
    type: "model.routed",
    payload: { dataClass: "mail_content", destination: "local", model: deps.local.model.id },
  });
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "thinking" } });
  for (const mail of mails) {
    let result: Classification;
    try {
      result = await classify(mail, deps);
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) {
        await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "error" } });
        throw error;
      }
      const waiting = mails.length - classified.length;
      await journal.append({
        agent: AGENT,
        type: "mail.model_waiting",
        payload: { sorted: classified.length, waiting },
      });
      await journal.append({
        agent: AGENT,
        type: "state.changed",
        payload: { to: "waiting_for_local_model" },
      });
      return { classified, waiting, counts, durationMs: Date.now() - started };
    }
    await deps.onClassified?.(result);
    // The category only: which mail it was never reaches the journal.
    await journal.append({
      agent: AGENT,
      type: "mail.model_sorted",
      payload: { category: result.category },
    });
    classified.push(result);
    counts[result.category]++;
    if (!result.valid) counts.invalid++;
  }
  const durationMs = Date.now() - started;
  await journal.append({
    agent: AGENT,
    type: "mail.sorted_by_model",
    payload: { ...counts, durationMs },
  });
  await journal.append({ agent: AGENT, type: "state.changed", payload: { to: "idle" } });
  return { classified, waiting: 0, counts, durationMs };
}
