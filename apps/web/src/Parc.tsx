/**
 * The Parc tab (14/11): the machines at a glance, in cards — the servers as
 * Legion sees them, the security findings still open, the security agent's
 * last round, the sentinel. Every text is plain text (React escapes it).
 * Refreshed every minute while the tab is open.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, getParc, type ParcView } from "./api.ts";
import { Machines } from "./Machines.tsx";
import {
  ago,
  parkTone,
  roundLate,
  SEVERITIES,
  severityLabel,
  severityTone,
  type Tone,
} from "./parc-rules.ts";
import { forgetToken } from "./token.ts";

const REFRESH_MS = 60_000;

function Dot({ tone, label }: { readonly tone: Tone; readonly label: string }) {
  return <span className={`point ton-${tone}`} role="img" aria-label={label} />;
}

/** Legion's verdict, in one line: its age, or why there is none — never "all is well". */
function LegionNote({ view, now }: { readonly view: ParcView["servers"]; readonly now: number }) {
  if (view.read !== "ok") {
    return (
      <p className="parc-note perime">
        {view.read === "missing"
          ? "Aucun verdict de Legion sur ce Mac : l'état des serveurs est inconnu."
          : "Le verdict de Legion est illisible : l'état des serveurs est inconnu."}
      </p>
    );
  }
  return (
    <p className={view.stale ? "parc-note perime" : "parc-note"}>
      Verdict de Legion {ago(view.at, now)}
      {view.stale && " — périmé : rien n'est sûr pour maintenant"}
    </p>
  );
}

function Findings({ view, now }: { readonly view: ParcView["findings"]; readonly now: number }) {
  return (
    <>
      <div className="parc-compteurs">
        {SEVERITIES.map((s) => (
          <div
            key={s}
            className={`parc-compteur ton-${view.counts[s] > 0 ? severityTone(s) : "inconnu"}`}
          >
            <span className="parc-chiffre">{view.counts[s]}</span>
            <span className="parc-etiquette">{severityLabel(s)}</span>
          </div>
        ))}
      </div>
      {view.open.length === 0 ? (
        <p className="parc-vide">Aucun constat ouvert.</p>
      ) : (
        <ul className="parc-lignes">
          {view.open.map((f) => (
            <li key={`${f.severity}-${f.since}-${f.title}`} className="parc-ligne">
              <Dot tone={severityTone(f.severity)} label={severityLabel(f.severity)} />
              <span className="parc-nom">{f.title}</span>
              <span className="parc-valeur">
                {f.inCharge ? "en cours" : ago(f.since, now).replace("il y a ", "")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.setAside > 0 && (
        <p className="parc-note">
          {view.setAside} mis de côté (risque accepté ou correctif écarté), toujours suivi(s).
        </p>
      )}
    </>
  );
}

function Watch({
  round,
  sentinel,
  now,
}: {
  readonly round: ParcView["lastRound"];
  readonly sentinel: ParcView["sentinel"];
  readonly now: number;
}) {
  const late = round === null || roundLate(round.at, now);
  return (
    <ul className="parc-lignes">
      <li className="parc-ligne">
        <Dot tone={late ? "mauvais" : "bon"} label={late ? "en retard" : "à l'heure"} />
        <span className="parc-nom">Ronde de sécurité</span>
        <span className="parc-valeur">{round === null ? "jamais" : ago(round.at, now)}</span>
        {round !== null && (
          <ul className="parc-motifs">
            <li>
              {round.checks} contrôle(s){round.network ? ", réseau compris" : ""}
              {round.impossible > 0 ? ` — ${round.impossible} n'ont pas pu tourner` : ""}
            </li>
          </ul>
        )}
      </li>
      <li className="parc-ligne">
        <Dot
          tone={sentinel === null ? "inconnu" : sentinel.up ? "bon" : "mauvais"}
          label={sentinel === null ? "inconnue" : sentinel.up ? "joignable" : "injoignable"}
        />
        <span className="parc-nom">Sentinelle</span>
        <span className="parc-valeur">
          {sentinel === null
            ? "jamais vue"
            : `${sentinel.up ? "joignable" : "injoignable"} ${ago(sentinel.since, now).replace("il y a", "depuis")}`}
        </span>
      </li>
    </ul>
  );
}

export function Parc({ token, onLost }: { readonly token: string; readonly onLost: () => void }) {
  const [view, setView] = useState<ParcView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setView(await getParc(token));
      setMessage(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        forgetToken();
        onLost();
        return;
      }
      setMessage(
        error instanceof ApiError
          ? `Le parc n'a pas pu être lu : ${error.message}`
          : "Le parc n'a pas pu être lu.",
      );
    }
  }, [token, onLost]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (view === null) {
    return <p className="bloc verrou">{message ?? "Lecture du parc…"}</p>;
  }
  const now = Date.parse(view.at);
  const tone = parkTone(view.servers, view.findings.counts);
  return (
    <section className="parc" aria-label="Le parc">
      {message !== null && <p className="message">{message}</p>}
      <Machines view={view} />
      <article className={`bloc parc-carte ton-cadre-${tone}`}>
        <h2>Sécurité</h2>
        <Findings view={view.findings} now={now} />
      </article>
      <article className="bloc parc-carte">
        <h2>Veille</h2>
        <LegionNote view={view.servers} now={now} />
        <Watch round={view.lastRound} sentinel={view.sentinel} now={now} />
      </article>
    </section>
  );
}
