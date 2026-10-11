/**
 * The fixes I asked for (🔧, J6c), done by the security agent's round: each
 * pending request is checked again — still a dependency with a published fix
 * — then prepared as a pull request (fix.ts), and I am told its link. The
 * pull requests already opened are followed on the network rounds: a failed
 * CI or a PR closed without merging is said once; a merge is left to the
 * checks, which will see the advisory gone and resolve the finding. The
 * journal gets the kind of outcome only.
 */
import type { Journal, SecuriteStore } from "@cenacle/journal";
import { type PrStatus, preparedFix } from "@cenacle/securite";
import type { FixRequest, FixResult } from "./fix.ts";

const AGENT = "securite";

export interface ActionDeps {
  readonly store: Pick<SecuriteStore, "pendingFixes" | "openPullRequests" | "setAction">;
  readonly prepare: (req: FixRequest) => Promise<FixResult>;
  /** Where a pull request stands (gh pr view). */
  readonly status: (url: string) => Promise<PrStatus>;
  readonly send: (text: string) => Promise<void>;
  readonly journal: Pick<Journal, "append">;
}

const STEP: Readonly<Record<string, string>> = {
  fetch: "récupérer main",
  worktree: "préparer la copie de travail",
  npm: "mettre à jour le fichier de verrouillage",
  diff: "vérifier que seuls les fichiers de paquets changent",
  commit: "faire le commit",
  push: "pousser la branche",
  pr: "ouvrir la PR",
};

export async function runActions(deps: ActionDeps, network: boolean): Promise<number> {
  let done = 0;
  for (const f of await deps.store.pendingFixes()) {
    const fix = preparedFix(f, f.params);
    if (fix === null) {
      await deps.store.setAction(f.id, "echouee");
      await deps.journal.append({
        agent: AGENT,
        type: "securite.action",
        payload: { outcome: "not_fixable" },
      });
      await deps.send(`🔧 Constat n°${f.id} : plus de correctif applicable, rien n'a été préparé.`);
      continue;
    }
    const result = await deps.prepare({ findingId: f.id, name: fix.name, version: fix.version });
    if (result.ok) {
      await deps.store.setAction(f.id, "pr_ouverte", result.url);
      await deps.send(
        `🔧 PR ouverte pour le constat n°${f.id} (${fix.name} → ${fix.version}) : ${result.url}\nLa CI la teste ; la fusion est à toi, jamais à l'agent.`,
      );
    } else {
      await deps.store.setAction(f.id, "echouee");
      await deps.send(
        `🔧 La PR du constat n°${f.id} n'a pas pu être préparée (étape : ${STEP[result.step] ?? result.step}). Rien de fusionné ; le constat reste pris en charge. Rappuie sur 🔧 pour réessayer.`,
      );
    }
    await deps.journal.append({
      agent: AGENT,
      type: "securite.action",
      payload: { outcome: result.ok ? "pr_opened" : `failed_${result.step}` },
    });
    done += 1;
  }
  if (!network) return done;
  for (const f of await deps.store.openPullRequests()) {
    if (f.actionPrUrl === null) continue;
    const state = await deps.status(f.actionPrUrl);
    if (state === "ci_failed") {
      await deps.store.setAction(f.id, "ci_echouee");
      await deps.send(
        `🔧 La CI de la PR du constat n°${f.id} a échoué : ${f.actionPrUrl}\nÀ toi de voir : la corriger ou la fermer.`,
      );
    } else if (state === "closed") {
      await deps.store.setAction(f.id, "abandonnee");
      await deps.send(
        `🔧 La PR du constat n°${f.id} a été fermée sans fusion : le constat reste pris en charge.`,
      );
    } else continue;
    await deps.journal.append({
      agent: AGENT,
      type: "securite.action",
      payload: { outcome: state },
    });
  }
  return done;
}
