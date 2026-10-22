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
      <div className="colonnes">
        <div className="principal">
          {token === null ? (
            <p className="bloc verrou">
              Pour voir les brouillons et parler au CTO, ouvre la page avec{" "}
              <code>npm run page</code> (le lien change à chaque démarrage du serveur).
            </p>
          ) : (
            <>
              <Proposals token={token} onLost={() => setToken(null)} />
              <Board token={token} onLost={() => setToken(null)} />
              <CtoAsk token={token} onLost={() => setToken(null)} />
            </>
          )}
        </div>
        <aside className="equipe" aria-label="L'équipe">
          <h2>L'équipe</h2>
          <AgentBox agent="iris" title="Iris" duty="Courrier" emblem="iris" />
          <AgentBox agent="cto" title="Le CTO" duty="Conseil technique" emblem="cto" />
        </aside>
      </div>
    </main>
  );
}
