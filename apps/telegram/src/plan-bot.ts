/**
 * The maintenance plan's buttons, on the bot's side (J7d, ADR-0035): my taps
 * under the summary and under the question. "Retirer" takes a reboot or a
 * machine out, "Valider" asks — with exactly what will run — and only my
 * "Confirmer" within 2 minutes makes the plan run; the operator alone acts.
 * Every tap is decided by the database with the plan's tokens; the decision
 * is written before any answer, so a failed edit of a message loses nothing.
 * Both switches are read at each tap. No AI decides anything here.
 */
import type { Journal, PlanStore } from "@cenacle/journal";
import {
  confirmPlanKeyboard,
  PLAN_ANSWER,
  type PlanPressed,
  planKeyboard,
  planMachines,
  planPrompt,
} from "@cenacle/securite";
import type { InlineButton, TelegramApi, TelegramCallback } from "./api.ts";

export interface PlanBotDeps {
  readonly api: Pick<TelegramApi, "sendWithButtons" | "answerCallback" | "editButtons">;
  readonly plans: Pick<PlanStore, "get" | "remove" | "ask" | "confirm">;
  /** `[serveurs] actif` and `[maintenance] actif` of securite.toml, read at each tap. */
  readonly serversActive: () => boolean;
  readonly maintenanceActive: () => boolean;
  readonly journal: Pick<Journal, "append">;
  readonly now: () => Date;
}

const inline = (rows: readonly { text: string; data: string }[][]): InlineButton[][] =>
  rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));

const noted = (deps: PlanBotDeps, quoi: string) =>
  deps.journal.append({ agent: "cenacle", type: "maintenance.plan", payload: { quoi } });

/** A message's buttons taken away; a failure only loses the edit. */
const clear = (deps: PlanBotDeps, chatId: number, messageId: number | null | undefined) =>
  messageId === null || messageId === undefined
    ? Promise.resolve()
    : deps.api.editButtons(chatId, messageId, []).catch(() => undefined);

export async function pressPlan(
  cb: TelegramCallback,
  chatId: number,
  pressed: PlanPressed,
  deps: PlanBotDeps,
): Promise<void> {
  if (!deps.maintenanceActive() || !deps.serversActive()) {
    await deps.api.answerCallback(cb.id, PLAN_ANSWER.off);
    return;
  }
  const now = deps.now();
  if (pressed.kind === "valider") {
    const token = await deps.plans.ask(pressed.planId, pressed.token, now);
    const plan = await deps.plans.get(pressed.planId);
    if (token === null || plan === null) {
      const empty =
        plan !== null &&
        (plan.state === "proposee" || plan.state === "a_confirmer") &&
        !plan.steps.some((s) => s.state === "attente");
      await deps.api.answerCallback(cb.id, empty ? PLAN_ANSWER.nothing : PLAN_ANSWER.stale);
      return;
    }
    await noted(deps, "valide");
    await deps.api.sendWithButtons(
      chatId,
      planPrompt(plan.id, plan.steps),
      inline(confirmPlanKeyboard(plan.id, token)),
    );
    await deps.api.answerCallback(cb.id, PLAN_ANSWER.asked);
    return;
  }
  if (pressed.kind === "confirmer") {
    const outcome = await deps.plans.confirm(pressed.planId, pressed.token, now);
    if (outcome === "done") await noted(deps, "confirme");
    await deps.api.answerCallback(cb.id, PLAN_ANSWER[outcome === "done" ? "confirmed" : outcome]);
    if (outcome === "done" || outcome === "expired") {
      await clear(deps, chatId, cb.message?.message_id);
      if (outcome === "done") {
        // The summary's buttons too: this plan can no longer change.
        await clear(deps, chatId, (await deps.plans.get(pressed.planId))?.messageId);
      }
    }
    return;
  }
  // Retirer: the machine is read by its place in the plan, never from the button's text.
  const plan = await deps.plans.get(pressed.planId);
  const machine = plan === null ? undefined : planMachines(plan.steps)[pressed.machine];
  const reboot = pressed.kind === "retirer_reboot";
  const removed =
    machine !== undefined &&
    (await deps.plans.remove(
      pressed.planId,
      pressed.token,
      machine.name,
      reboot ? "redemarrer" : null,
    ));
  if (!removed || machine === undefined) {
    await deps.api.answerCallback(cb.id, PLAN_ANSWER.stale);
    return;
  }
  await noted(deps, reboot ? "retire_redemarrage" : "retire_machine");
  await deps.api.answerCallback(
    cb.id,
    reboot ? PLAN_ANSWER.removedReboot(machine.name) : PLAN_ANSWER.removed(machine.name),
  );
  const after = await deps.plans.get(pressed.planId);
  if (after !== null && cb.message !== undefined) {
    await deps.api
      .editButtons(
        chatId,
        cb.message.message_id,
        inline(planKeyboard(after.id, pressed.token, planMachines(after.steps))),
      )
      .catch(() => undefined);
  }
}
