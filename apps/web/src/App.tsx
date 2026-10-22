import { useEffect, useState } from "react";
import { AgentBox } from "./AgentBox.tsx";
import { Board } from "./Board.tsx";
import { CtoAsk } from "./CtoAsk.tsx";
import { Proposals } from "./Proposals.tsx";
import { takeToken } from "./token.ts";

const TODAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function App() {
  const [token, setToken] = useState<string | null>(() => takeToken());
  // The link pasted into an already open page changes only the part after #.
  useEffect(() => {
    const onHash = () => {
      const fresh = takeToken();
      if (fresh !== null) setToken(fresh);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <main className="page">
      <header className="entete">
        <h1>Cénacle</h1>
        <span className="date">{TODAY.format(new Date())}</span>
      </header>
      <aside className="equipe" aria-label="L'équipe">
        <h2>L'équipe</h2>
        <div className="equipe-agents">
          <AgentBox agent="iris" title="Iris" duty="Courrier" emblem="iris" />
          <AgentBox agent="cto" title="Le CTO" duty="Conseil technique" emblem="cto" />
          <AgentBox
            agent="prospection"
            title="Le prospecteur"
            duty="Veille des missions"
            emblem="prospection"
          />
        </div>
      </aside>
      {token === null ? (
        <p className="bloc verrou">
          Pour voir les missions, les brouillons et parler au CTO, ouvre la page avec{" "}
          <code>npm run page</code> (le lien change à chaque démarrage du serveur).
        </p>
      ) : (
        <div className="colonnes">
          <div className="cote-missions">
            <Board token={token} onLost={() => setToken(null)} />
          </div>
          <div className="principal">
            <Proposals token={token} onLost={() => setToken(null)} />
            <CtoAsk token={token} onLost={() => setToken(null)} />
          </div>
        </div>
      )}
    </main>
  );
}
