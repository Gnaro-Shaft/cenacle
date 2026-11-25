/**
 * The « Maison » tab (ADR-0048): I confide work to the house, and read where
 * it is. A new demand is typed here (or on Telegram, /maison), then corrected
 * and accepted on its card. The rule is said where I type: no client's name,
 * no mail's content — the text goes to a model abroad, through the house.
 * Read when the tab opens, then every 30 seconds while it stays open.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api.ts";
import { DemandeCard } from "./DemandeCard.tsx";
import { creerDemande, getLiaison, type LiaisonView } from "./liaison-api.ts";
import { formBlocker, lectureLabel } from "./maison-rules.ts";
import { forgetToken } from "./token.ts";

const REFRESH_MS = 30_000;

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function NouvelleDemande({
  dossiers,
  token,
  onDone,
}: {
  readonly dossiers: readonly string[];
  readonly token: string;
  readonly onDone: (message: string | null) => void;
}) {
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [dossier, setDossier] = useState(dossiers[0] ?? "");
  const [busy, setBusy] = useState(false);
  const blocker = formBlocker({ titre, description, dossier });

  const submit = async () => {
    setBusy(true);
    try {
      const { id } = await creerDemande(token, { titre, description, dossier });
      setTitre("");
      setDescription("");
      onDone(`Demande n° ${id} enregistrée : relis-la, puis accepte-la sur sa carte.`);
    } catch (error) {
      onDone(error instanceof ApiError ? `Refusé : ${error.message}` : "Le serveur ne répond pas.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="bloc nouvelle-demande"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Confier un travail à la maison</h2>
      <p className="regle">
        Ni nom de client ni contenu de mail : le texte part chez un modèle aux États-Unis, par la
        maison. Courriels, téléphones, IBAN, liens et longs numéros sont refusés.
      </p>
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
          {dossiers.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="submit" disabled={busy || blocker !== null}>
          {blocker === null ? "Enregistrer la demande" : `Il manque ${blocker}`}
        </button>
      </div>
    </form>
  );
}

export function Maison({ token, onLost }: { readonly token: string; readonly onLost: () => void }) {
  const [view, setView] = useState<LiaisonView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const now = useNow(1000);

  const load = useCallback(async () => {
    try {
      setView(await getLiaison(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        forgetToken();
        onLost();
        return;
      }
      setMessage(error instanceof ApiError ? error.message : "Le serveur ne répond pas.");
    }
  }, [token, onLost]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const done = (m: string | null) => {
    setMessage(m);
    void load();
  };

  if (view === null) return <p className="bloc">{message ?? "Lecture…"}</p>;
  return (
    <section className="maison" aria-label="La maison">
      {view.actif !== "actif" && (
        <p className="bloc verrou">
          La liaison est {view.actif === "coupe" ? "coupée" : "illisible"} (
          <code>liaison.toml</code>) : rien ne part vers la maison, rien n'en est lu.
        </p>
      )}
      {view.config !== null && (
        <p className="bloc verrou">
          <code>liaison.local.toml</code> est à revoir ({view.config}) :{" "}
          <code>npm run liaison:verifier</code>.
        </p>
      )}
      {message !== null && <p className="bloc message">{message}</p>}
      {view.dossiers.length > 0 && (
        <NouvelleDemande dossiers={view.dossiers} token={token} onDone={done} />
      )}
      <p className="lecture">{lectureLabel(view.lecture, now)}</p>
      {view.demandes.length === 0 ? (
        <p className="bloc">Aucune demande ces 30 derniers jours.</p>
      ) : (
        view.demandes.map((d) => (
          <DemandeCard
            key={`${d.id}-${d.statut}`}
            d={d}
            dossiers={view.dossiers}
            token={token}
            now={now}
            onDone={done}
          />
        ))
      )}
    </section>
  );
}
