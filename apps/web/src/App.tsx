import { useEffect, useState } from "react";
import { AgentBox } from "./AgentBox.tsx";
import type { Emblem } from "./Avatar.tsx";
import { Board } from "./Board.tsx";
import { CtoAsk } from "./CtoAsk.tsx";
import { Proposals } from "./Proposals.tsx";
import { takeToken } from "./token.ts";
import { useTeamStream } from "./useTeamStream.ts";

const TODAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** The team band, in its order; all its cards share one stream. */
const TEAM: readonly { agent: string; title: string; duty: string; emblem: Emblem }[] = [
  { agent: "iris", title: "Iris", duty: "Courrier", emblem: "iris" },
  { agent: "cto", title: "Le CTO", duty: "Conseil technique", emblem: "cto" },
  {
    agent: "prospection",
    title: "Le prospecteur",
    duty: "Veille des missions",
    emblem: "prospection",
  },
  { agent: "securite", title: "L'agent sécurité", duty: "Ronde de sécurité", emblem: "securite" },
  {
    agent: "operateur",
    title: "L'opérateur",
    duty: "Actions sur les serveurs",
    emblem: "operateur",
  },
  {
    agent: "sentinel",
    title: "La sentinelle",
    duty: "Liaison du Mac (ses battements arrivent-ils ?)",
    emblem: "sentinel",
  },
];
const AGENTS = TEAM.map((member) => member.agent);

export function App() {
  const team = useTeamStream(AGENTS);
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
          {TEAM.map((member) => (
            <AgentBox
              key={member.agent}
              stream={team.get(member.agent) ?? { kind: "connecting" }}
              title={member.title}
              duty={member.duty}
              emblem={member.emblem}
            />
          ))}
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
