/**
 * The CTO's look at compliance (phase 6, J4 — ADR-0022): he gets the report of
 * the deterministic checks and looks for what code cannot settle — a recent
 * ADR that creates a processing or an AI use missing from the registers, an
 * information notice that does not cover an open processing. Experimental,
 * like the review; his references are checked; never legal advice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CtoDeps, type CtoReply, gitView, runCto } from "@cenacle/cto";
import { checkConformity } from "./conformity.ts";
import type { Verdict } from "./exceptions.ts";
import { parseExceptions } from "./exceptions.ts";
import { loadFacts } from "./facts.ts";

export function conformityPrompt(v: Verdict): string {
  const findings =
    v.findings.length === 0
      ? "aucun écart"
      : v.findings.map((f) => `- [${f.check}] ${f.detail}`).join("\n");
  return [
    "Contrôle de conformité de Cénacle. Le code a déjà vérifié la concordance des registres, du cadre, du code et de la documentation (ADR-0022). Son rapport :",
    `Écarts : ${findings}`,
    `Écarts acceptés (docs/conformite/exceptions.md) : ${v.excused.length}.`,
    "Cherche ce que le code ne sait pas vérifier, dans la documentation et avec tes outils :",
    "1. Un ADR récent crée-t-il un traitement, un service tiers, un usage de l'IA ou une donnée personnelle absents de `docs/conformite/registre-traitements.md` ou de `docs/conformite/registre-ia.md` ?",
    "2. La mention d'information (`docs/conformite/mention-information.md`) couvre-t-elle chaque traitement ouvert du registre ?",
    "3. Une durée de conservation du registre manque-t-elle de justification par sa finalité ?",
    "Pour chaque écart : ce qui manque, où (`chemin:ligne`), et ce qu'il faudrait écrire. Si tu ne trouves rien de réel, réponds « Aucun écart trouvé. » Tu ne donnes pas d'avis juridique : tu signales des points à faire trancher.",
  ].join("\n");
}

export function conformityCto(root: string, deps: CtoDeps): Promise<CtoReply> {
  const exceptions = parseExceptions(
    readFileSync(join(root, "docs", "conformite", "exceptions.md"), "utf8"),
  );
  const verdict = checkConformity(loadFacts(root), exceptions);
  return runCto(conformityPrompt(verdict), gitView(root, "HEAD"), deps, { kind: "conformity" });
}
