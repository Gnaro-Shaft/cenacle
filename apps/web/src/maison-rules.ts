/**
 * The « Maison » tab's rules (ADR-0048), apart from React so that they are
 * tested: what each state is called, why a demand failed, how long is left to
 * cancel, how old the last reading is, and which links may be shown at all —
 * checked again here, a link the house returns being written by its model.
 */
import type { DemandeView, LiaisonView, StatutDemande } from "./liaison-api.ts";

export const STATUT_LABEL: Record<StatutDemande, string> = {
  attente: "à relire",
  acceptee: "acceptée, part dans",
  refusee: "refusée",
  annulee: "annulée",
  caduque: "caduque",
  en_cours: "en cours d'envoi",
  transmise: "transmise",
  echouee: "échouée",
};

/** Paperclip's statuses, said in French; another word is shown as it came (it is data). */
const MAISON_LABEL: Record<string, string> = {
  backlog: "en réserve",
  todo: "à faire",
  in_progress: "en cours",
  in_review: "en relecture",
  blocked: "bloquée",
  done: "terminée",
  cancelled: "abandonnée",
};
export const maisonLabel = (statut: string): string =>
  Object.hasOwn(MAISON_LABEL, statut) ? (MAISON_LABEL[statut] as string) : statut;

/** Why a demand failed: its category, in words; the house's reason is never kept. */
export function echecLabel(categorie: string | null): string {
  switch (categorie) {
    case "transport":
      return "liaison coupée en route : elle a peut-être été déposée, regarde l'état ci-dessous avant de la refaire";
    case "reponse":
      return "réponse de la maison illisible : état inconnu";
    case "ssh":
      return "ssh n'a pas démarré : rien n'est parti";
    case "non_signee":
      return "acceptation non signée par la page : rien n'est parti";
    case "dossier":
      return "dossier plus déclaré : rien n'est parti";
    case null:
      return "";
    default:
      return `refusée (${categorie})`;
  }
}

/** Seconds left to cancel, or 0 once the delay is over (the server says so too). */
export function secondesPourAnnuler(d: DemandeView, now: number): number {
  if (d.statut !== "acceptee" || d.partirApres === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(d.partirApres) - now) / 1000));
}

/** How the last reading of `etat` is said: never an old one presented as fresh. */
export function lectureLabel(lecture: LiaisonView["lecture"], now: number): string {
  if (lecture === null) return "état de la maison jamais lu";
  const minutes = Math.max(0, Math.floor((now - Date.parse(lecture.le)) / 60_000));
  const age = minutes < 1 ? "à l'instant" : `il y a ${minutes} min`;
  return lecture.issue === "lu" ? `état lu ${age}` : `dernière lecture en échec (${age})`;
}

const PR_RULE =
  /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}\/pull\/[0-9]{1,7}$/;
/** A link is shown only if it is a pull request on GitHub, of the exact form. */
export const lienSur = (url: string): boolean => PR_RULE.test(url);

/** What the form refuses before sending (the server and the house check again). */
export function formBlocker(t: {
  titre: string;
  description: string;
  dossier: string;
}): string | null {
  if (t.titre.trim() === "") return "un titre";
  if (t.titre.includes("\n")) return "un titre sur une ligne";
  if ([...t.titre.trim()].length > 120) return "un titre de 120 caractères au plus";
  if (t.description.trim() === "") return "une description";
  if ([...t.description.trim()].length > 4000) return "une description de 4 000 caractères au plus";
  if (t.dossier === "") return "un dossier";
  return null;
}
