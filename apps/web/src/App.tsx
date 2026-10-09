import { useEffect, useState } from "react";
import { AgentBox } from "./AgentBox.tsx";
import { CtoAsk } from "./CtoAsk.tsx";
import { Proposals } from "./Proposals.tsx";
import { takeToken } from "./token.ts";

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
      <h1>Cénacle</h1>
      <section className="grid" aria-label="Les agents">
        <AgentBox agent="iris" title="Iris" duty="Courrier" />
        <AgentBox agent="cto" title="CTO" duty="Conseil technique" />
      </section>
      {token === null ? (
        <p className="detail locked">
          🔒 Pour voir les brouillons et parler au CTO, ouvre la page avec <code>npm run page</code>{" "}
          (le lien change à chaque démarrage du serveur).
        </p>
      ) : (
        <>
          <CtoAsk token={token} onLost={() => setToken(null)} />
          <Proposals token={token} onLost={() => setToken(null)} />
        </>
      )}
    </main>
  );
}
