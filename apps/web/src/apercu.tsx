/**
 * The page's preview (2026-10-14), for the development server only: every
 * state of the agents and of the drafts, with fictitious data, to see the
 * look without the API, the database or the token. Nothing leaves it: fetch
 * is replaced by a refusal before anything renders, and no stream is opened.
 */
import type { MailCounts } from "@cenacle/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentCard } from "./AgentCard.tsx";
import type { ProposalView } from "./api.ts";
import { CtoAsk } from "./CtoAsk.tsx";
import { Card } from "./Proposals.tsx";
import "./charte.css";
import "./mise-en-page.css";
import "./agents.css";
import "./brouillons.css";

window.fetch = () => Promise.reject(new Error("aperçu : aucun appel au serveur"));

const MAIL: MailCounts = {
  clients_prospects: 4,
  administratif: 7,
  bruit: 23,
  a_trier: 1,
  pending: 2,
  waiting: 3,
  due: 1,
};

const draft = (over: Partial<ProposalView>): ProposalView => ({
  id: "apercu-1",
  status: "pending",
  trame: "prise de rendez-vous",
  draft:
    "Bonjour,\n\nMerci pour votre retour. Je vous propose un point jeudi à {heure ?}.\n\nBien à vous",
  createdAt: "2026-10-14T12:00:00Z",
  sendAfter: null,
  mail: {
    subject: "Point sur le devis",
    fromName: "Atelier Exemple",
    to: "contact@atelier.exemple.test",
    replyToElsewhere: false,
  },
  toComplete: ["heure"],
  unsupported: [],
  delivery: "real",
  ...over,
});

const DRAFTS = [
  draft({}),
  draft({
    id: "apercu-2",
    status: "accepted",
    draft: "Bonjour,\n\nC'est noté, merci.",
    sendAfter: new Date(Date.now() + 90_000).toISOString(),
    toComplete: [],
  }),
  draft({
    id: "apercu-3",
    status: "failed",
    draft: "Bonjour,\n\nVoici la facture.",
    toComplete: [],
  }),
];

const nothing = () => undefined;

function Apercu() {
  return (
    <main className="page">
      <header className="entete">
        <h1>Cénacle — aperçu</h1>
        <span className="date">données fictives, aucun appel au serveur</span>
      </header>
      <div className="colonnes">
        <div className="principal">
          <section id="brouillons" className="bloc decide" aria-label="Brouillons à décider">
            <div className="bloc-titre">
              <h2>À décider</h2>
              <span className="compte-rouge">1 brouillon</span>
            </div>
            {DRAFTS.map((p) => (
              <Card key={p.id} p={p} token="apercu" onDone={nothing} />
            ))}
          </section>
          <CtoAsk token="apercu" onLost={nothing} />
          <section className="bloc" aria-label="Tous les états">
            <h2>Tous les états</h2>
            <AgentCard
              title="Au repos"
              duty="rien en cours"
              emblem="cto"
              visual="resting"
              pending={0}
              detail={null}
              mail={null}
            />
            <AgentCard
              title="Au travail"
              duty="anneau ambre qui pulse"
              emblem="cto"
              visual="working"
              pending={0}
              detail={null}
              mail={null}
            />
            <AgentCard
              title="Attend ton accord"
              duty="des brouillons à décider"
              emblem="iris"
              visual="resting"
              pending={2}
              detail={null}
              mail={null}
            />
            <AgentCard
              title="Malade"
              duty="un problème signalé"
              emblem="iris"
              visual="sick"
              pending={3}
              detail="purge en échec : les durées de conservation ne sont pas tenues"
              mail={null}
            />
            <AgentCard
              title="Hors ligne"
              duty="le serveur ne répond pas"
              emblem="cto"
              visual="offline"
              pending={0}
              detail="le serveur ne répond pas"
              mail={null}
            />
          </section>
        </div>
        <aside className="equipe" aria-label="L'équipe">
          <h2>L'équipe</h2>
          <AgentCard
            title="Iris"
            duty="Courrier"
            emblem="iris"
            visual="working"
            pending={1}
            detail={null}
            mail={MAIL}
          />
          <AgentCard
            title="Le CTO"
            duty="Conseil technique"
            emblem="cto"
            visual="working"
            pending={0}
            detail={null}
            mail={null}
          />
        </aside>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from apercu.html");
createRoot(root).render(
  <StrictMode>
    <Apercu />
  </StrictMode>,
);
