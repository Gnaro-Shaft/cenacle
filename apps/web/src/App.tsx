import { useEffect, useState } from "react";
import { AgentBox } from "./AgentBox.tsx";
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
      </section>
      {token === null ? (
        <p className="detail locked">
          🔒 Pour voir et valider les brouillons, ouvre le lien affiché par{" "}
          <code>npm run server</code> (il change à chaque démarrage du serveur).
        </p>
      ) : (
        <Proposals token={token} onLost={() => setToken(null)} />
      )}
    </main>
  );
}
