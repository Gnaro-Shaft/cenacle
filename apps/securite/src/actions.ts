/**
 * The fixes and their pull requests, at each round of the security agent
 * (J6c, J6d — ADR-0025, ADR-0026):
 *  - a delegation that reached its threshold is proposed by the CTO, once;
 *  - a granted delegation prepares a fixable advisory (no major change) by itself;
 *  - my ✅ Fusionner / ❌ Fermer are done (merge.ts checks everything again);
 *  - the fixes I asked for (🔧), or a delegation did, are prepared (fix.ts);
 *  - each pull request is followed: CI green → the merge buttons; red, or
 *    closed, or merged by me on GitHub → said once.
 * Each outcome is journaled for the trust record (securite.action), with its
 * delegable action and whether it was delegated; a failure on a delegated
 * pull request suspends the delegation at once. Never a merge without my
 * button; merging is never delegated.
 */
import type { Journal, SecuriteStore, StoredFinding } from "@cenacle/journal";
import {
  type Button,
  DELEGABLE_LABEL,
  type Delegable,
  type DelegationState,
  delegableFix,
  type PrView,
  preparedFix,
  prKeyboard,
} from "@cenacle/securite";
import type { FixRequest, FixResult } from "./fix.ts";
import type { MergeOutcome } from "./merge.ts";

const AGENT = "securite";
const DELEGABLE: Delegable = "preparer_pr_npm";

export interface DelegationInfo {
  readonly action: Delegable;
  readonly state: DelegationState;
  readonly seuil: number;
  readonly mergedClean: number;
  /** When the CTO proposed it, if it did since. */
  readonly proposedAt: Date | null;
}

export interface ActionDeps {
  readonly store: Pick<
    SecuriteStore,
    "open" | "pendingFixes" | "openPullRequests" | "prRequests" | "setAction" | "delegateFix"
  >;
  readonly prepare: (req: FixRequest) => Promise<FixResult>;
  readonly view: (url: string) => Promise<PrView>;
  readonly merge: (url: string, sha: string) => Promise<MergeOutcome>;
  readonly close: (url: string) => Promise<boolean>;
  readonly tokens: (ids: readonly number[]) => Promise<Map<number, string>>;
  readonly send: (text: string) => Promise<void>;
  readonly sendButtons: (text: string, rows: Button[][]) => Promise<void>;
  readonly journal: Pick<Journal, "append">;
  readonly delegations: readonly DelegationInfo[];
  readonly now: () => Date;
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

const REFUSAL: Readonly<Record<string, string>> = {
  unknown: "son état est illisible",
  state: "elle est déjà fusionnée ou fermée",
  moved: "un autre commit y a été poussé depuis la CI que tu as vue",
  ci: "sa CI n'est plus verte",
  base: "elle ne vise plus main",
  files: "elle touche autre chose que des fichiers de paquets",
  gh: "GitHub a refusé la fusion",
};

const FAILURES = new Set(["closed", "ci_failed", "merged_edited"]);

async function record(deps: ActionDeps, f: StoredFinding, outcome: string): Promise<void> {
  await deps.journal.append({
    agent: AGENT,
    type: "securite.action",
    payload: { outcome, delegable: DELEGABLE, delegated: f.actionDelegated },
  });
  if (f.actionDelegated && FAILURES.has(outcome)) {
    await deps.journal.append({
      agent: AGENT,
      type: "securite.delegation",
      payload: { delegable: DELEGABLE, state: "suspendue" },
    });
    await deps.send(
      `⏸ Délégation suspendue : « ${DELEGABLE_LABEL[DELEGABLE]} » (constat n°${f.id}, ${outcome}). Elle reprendra si tu changes la date d'accord dans securite.toml.`,
    );
  }
}

async function delegate(deps: ActionDeps): Promise<void> {
  for (const d of deps.delegations) {
    if (d.state === "proposable" && d.proposedAt === null) {
      await deps.send(
        `🤝 Le CTO te propose une délégation : « ${DELEGABLE_LABEL[d.action]} ». Le carnet compte ${d.mergedClean} PR fusionnées sans retouche, sans aucun échec (seuil : ${d.seuil}).\nPour l'accorder, ajoute dans securite.toml, par une PR :\naccordee_le = ${deps.now().toISOString().slice(0, 10)}\nLa fusion restera à toi.`,
      );
      await deps.journal.append({
        agent: AGENT,
        type: "securite.delegation",
        payload: { delegable: d.action, state: "proposee" },
      });
    }
  }
  if (!deps.delegations.some((d) => d.action === DELEGABLE && d.state === "accordee")) return;
  for (const f of await deps.store.open()) {
    if (f.actionState !== null || preparedFix(f, f.params) === null) continue;
    if (delegableFix(f.params)) await deps.store.delegateFix(f.id, deps.now());
  }
}

async function requests(deps: ActionDeps): Promise<void> {
  for (const f of await deps.store.prRequests()) {
    const url = f.actionPrUrl;
    if (url === null) continue;
    if (f.actionState === "fermeture_demandee") {
      const closed = await deps.close(url);
      await deps.store.setAction(f.id, closed ? "fermee" : "ci_verte");
      if (closed) await record(deps, f, "closed");
      await deps.send(
        closed
          ? `❌ PR fermée (constat n°${f.id}).`
          : `❌ La PR du constat n°${f.id} n'a pas pu être fermée : réessaie.`,
      );
      continue;
    }
    const merged = f.actionHeadSha === null ? null : await deps.merge(url, f.actionHeadSha);
    if (merged?.ok === true) {
      await deps.store.setAction(f.id, "fusionnee");
      await record(deps, f, merged.clean ? "merged_clean" : "merged_edited");
      await deps.send(
        `✅ PR fusionnée (constat n°${f.id}) : ${url}\nLa ronde verra la faille disparaître.`,
      );
    } else {
      // Back to being followed: new buttons once the CI is green on what is there now.
      await deps.store.setAction(f.id, "pr_ouverte");
      const why =
        merged === null
          ? "aucun commit testé n'est connu"
          : (REFUSAL[merged.reason] ?? merged.reason);
      await deps.send(`✅ Fusion refusée (constat n°${f.id}) : ${why}. Rien n'a été fusionné.`);
    }
  }
}

async function prepare(deps: ActionDeps): Promise<number> {
  let done = 0;
  for (const f of await deps.store.pendingFixes()) {
    const fix = preparedFix(f, f.params);
    if (fix === null) {
      await deps.store.setAction(f.id, "echouee");
      await record(deps, f, "not_fixable");
      await deps.send(`🔧 Constat n°${f.id} : plus de correctif applicable, rien n'a été préparé.`);
      continue;
    }
    const result = await deps.prepare({ findingId: f.id, name: fix.name, version: fix.version });
    const by = f.actionDelegated ? "délégué" : "sur ta demande";
    if (result.ok) {
      await deps.store.setAction(f.id, "pr_ouverte", result.url);
      await record(deps, f, "pr_opened");
      await deps.send(
        `🔧 PR ouverte (${by}) pour le constat n°${f.id} (${fix.name} → ${fix.version}) : ${result.url}\nLa CI la teste ; je t'enverrai ✅ Fusionner quand elle sera verte.`,
      );
    } else {
      await deps.store.setAction(f.id, "echouee");
      await record(deps, f, `failed_${result.step}`);
      await deps.send(
        `🔧 La PR du constat n°${f.id} n'a pas pu être préparée (étape : ${STEP[result.step] ?? result.step}). Rien de fusionné ; le constat reste pris en charge. Rappuie sur 🔧 pour réessayer.`,
      );
    }
    done += 1;
  }
  return done;
}

async function follow(deps: ActionDeps): Promise<void> {
  for (const f of await deps.store.openPullRequests()) {
    const url = f.actionPrUrl;
    if (url === null) continue;
    const v = await deps.view(url);
    if (v.status === "merged") {
      await deps.store.setAction(f.id, "fusionnee");
      await record(deps, f, v.commits === 1 ? "merged_clean" : "merged_edited");
    } else if (v.status === "closed") {
      await deps.store.setAction(f.id, "abandonnee");
      await record(deps, f, "closed");
      await deps.send(
        `🔧 La PR du constat n°${f.id} a été fermée sans fusion : le constat reste pris en charge.`,
      );
    } else if (v.status === "ci_failed" && f.actionState === "pr_ouverte") {
      await deps.store.setAction(f.id, "ci_echouee");
      await record(deps, f, "ci_failed");
      await deps.send(
        `🔧 La CI de la PR du constat n°${f.id} a échoué : ${url}\nÀ toi de voir : la corriger ou la fermer.`,
      );
    } else if (v.status === "ci_passed" && f.actionState === "pr_ouverte" && v.headSha !== null) {
      const token = (await deps.tokens([f.id])).get(f.id);
      if (token === undefined) continue;
      await deps.store.setAction(f.id, "ci_verte", undefined, v.headSha);
      await deps.sendButtons(
        `🔧 La CI de la PR du constat n°${f.id} est verte : ${url}\nOn la fusionne ? Seuls des fichiers de paquets changent ; la fusion se fera sur ce commit-là (${v.headSha.slice(0, 7)}), sinon rien.`,
        prKeyboard(f.id, token),
      );
    } else if (f.actionState === "ci_verte" && v.headSha !== f.actionHeadSha) {
      // Something was pushed after the buttons: they no longer apply.
      await deps.store.setAction(f.id, "pr_ouverte");
    }
  }
}

/** Everything about fixes, once per round. Returns how many fixes were prepared. */
export async function runActions(deps: ActionDeps): Promise<number> {
  await delegate(deps);
  await requests(deps);
  const done = await prepare(deps);
  await follow(deps);
  return done;
}
