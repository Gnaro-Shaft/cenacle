/**
 * One demand to the house (ADR-0048). Waiting: I correct it, then accept it
 * — Accept stays locked while my edit is not saved, and it carries the text
 * I was shown — or refuse it (asked twice: it is final). Accepted: 2 minutes
 * to cancel. Handed over: the ticket, and what the house last said of it; its
 * titles are written by the house's model, shown as plain text (React escapes
 * it), labelled as such; only links of the exact form of a pull request are
 * links. Nothing leaves from here: the `liaison` program does it.
 */
import { useState } from "react";
import { ApiError } from "./api.ts";
import { accepterDemande, agirDemande, corrigerDemande, type DemandeView } from "./liaison-api.ts";
import {
  echecLabel,
  formBlocker,
  lienSur,
  maisonLabel,
  STATUT_LABEL,
  secondesPourAnnuler,
} from "./maison-rules.ts";

export function DemandeCard({
  d,
  dossiers,
  token,
  now,
  onDone,
}: {
  readonly d: DemandeView;
  readonly dossiers: readonly string[];
  readonly token: string;
  readonly now: number;
  readonly onDone: (message: string | null) => void;
}) {
  const [titre, setTitre] = useState(d.titre ?? "");
  const [description, setDescription] = useState(d.description ?? "");
  const [dossier, setDossier] = useState(d.dossier);
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const dirty = titre !== d.titre || description !== d.description || dossier !== d.dossier;
  const blocker = formBlocker({ titre, description, dossier });
  const left = secondesPourAnnuler(d, now);

  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      onDone(done);
    } catch (error) {
      onDone(error instanceof ApiError ? `Refusé : ${error.message}` : "Le serveur ne répond pas.");
    } finally {
      setBusy(false);
    }
  };
  const texte = { titre, description, dossier };

  return (
    <article className={`bloc demande demande-${d.statut}`} aria-label={`Demande n° ${d.id}`}>
      <header className="demande-tete">
        <span className="demande-numero">n° {d.id}</span>
        <span className="demande-statut">
          {STATUT_LABEL[d.statut]}
          {d.statut === "acceptee" && ` ${Math.floor(left / 60)} min ${left % 60} s`}
        </span>
        {d.ticket !== null && <span className="demande-ticket">{d.ticket}</span>}
      </header>

      {d.statut === "attente" ? (
        <div className="demande-edition">
          <label>
            Titre
            <input value={titre} maxLength={120} onChange={(e) => setTitre(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              value={description}
              maxLength={4000}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Dossier
            <select value={dossier} onChange={(e) => setDossier(e.target.value)}>
              {[...new Set([...dossiers, d.dossier])].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={busy || !dirty || blocker !== null}
              onClick={() =>
                run(() => corrigerDemande(token, d.id, texte), "Correction enregistrée.")
              }
            >
              Enregistrer
            </button>
            <button
              type="button"
              className="principal"
              disabled={busy || dirty || blocker !== null}
              title={dirty ? "Enregistre d'abord ta correction" : undefined}
              onClick={() =>
                run(
                  () => accepterDemande(token, d.id, texte),
                  `Demande n° ${d.id} acceptée : elle part dans 2 minutes, annulable d'ici là.`,
                )
              }
            >
              Accepter et confier à la maison
            </button>
            {refusing ? (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => run(() => agirDemande(token, d.id, "refuser"), "Demande refusée.")}
              >
                Confirmer le refus (définitif)
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => setRefusing(true)}>
                Refuser
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="demande-texte">
          <h3>{d.titre ?? "(texte effacé)"}</h3>
          {d.description !== null && <p className="demande-description">{d.description}</p>}
          <p className="demande-dossier">Dossier : {d.dossier}</p>
          {d.statut === "acceptee" && left > 0 && (
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => agirDemande(token, d.id, "annuler"), "Demande annulée.")}
              >
                Annuler
              </button>
            </div>
          )}
          {d.statut === "echouee" && <p className="erreur">{echecLabel(d.categorie)}</p>}
        </div>
      )}

      {d.maison !== null && (
        <section className="demande-maison" aria-label="Chez la maison">
          <p>
            Chez la maison : <strong>{maisonLabel(d.maison.statut)}</strong>
          </p>
          <p className="ecrit-par-ia">
            Écrit par le majordome (IA) : <span>{d.maison.titre}</span>
          </p>
          {d.maison.sousTickets.length > 0 && (
            <ul className="sous-tickets">
              {d.maison.sousTickets.map((s) => (
                <li key={s.ticket}>
                  {s.ticket} — {maisonLabel(s.statut)} —{" "}
                  <span className="ecrit-par-ia">{s.titre}</span>
                </li>
              ))}
            </ul>
          )}
          {d.maison.pr.filter(lienSur).map((url) => (
            <p key={url} className="demande-pr">
              PR à relire :{" "}
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* owner/repo/pull/n: the link's path, its host being fixed by lienSur */}
                {url.split("/").slice(3).join("/")}
              </a>
            </p>
          ))}
        </section>
      )}
    </article>
  );
}
