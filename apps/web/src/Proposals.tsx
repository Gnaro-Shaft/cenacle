/**
 * The drafts waiting for me (phase 4, B3). Each one shows its imposed
 * recipient (not editable), its red flags, the text I can edit, and
 * Accept / Refuse. Accept stays locked while a slot is left, while my edit
 * is not saved, or when the recipient cannot be read. Once accepted, I have
 * 2 minutes to cancel. Nothing is sent from here: the executor does it (B4).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, act, listProposals, type ProposalView, saveDraft } from "./api.ts";
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

function Card({
  p,
  token,
  onDone,
}: {
  readonly p: ProposalView;
  readonly token: string;
  readonly onDone: (message: string | null) => void;
}) {
  const [text, setText] = useState(p.draft);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const dirty = text !== p.draft;
  const leftSlots = [...text.matchAll(/\{([a-z_]+) \?\}/g)].map((m) => m[1]);

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

  if (p.status === "sending" || p.status === "failed") {
    return (
      <article className={`proposal ${p.status}`} aria-label={`Brouillon ${p.id}`}>
        <header>
          <strong>{p.mail?.subject ?? "(mail introuvable)"}</strong>
          <span className="to">À : {p.mail?.to ?? "—"}</span>
        </header>
        <pre className="draft-text">{p.draft}</pre>
        <p className={p.status === "failed" ? "countdown failed" : "countdown"}>
          {p.status === "sending"
            ? "📤 Envoi en cours…"
            : "❌ L'envoi a échoué. Il n'est jamais réessayé tout seul : réponds depuis ta messagerie si besoin."}
        </p>
      </article>
    );
  }

  if (p.status === "accepted") {
    const left = Math.max(0, Math.ceil((Date.parse(p.sendAfter ?? "") - now) / 1000));
    return (
      <article className="proposal accepted" aria-label={`Brouillon accepté ${p.id}`}>
        <header>
          <strong>{p.mail?.subject ?? "(mail introuvable)"}</strong>
          <span className="to">À : {p.mail?.to ?? "—"}</span>
        </header>
        <pre className="draft-text">{p.draft}</pre>
        <p className="countdown">
          {left > 0
            ? `✅ Accepté — annulable encore ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")} s`
            : "✅ Accepté — l'exécuteur l'envoie à son prochain passage (npm run executor)"}
        </p>
        {left > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => act(token, p.id, "cancel"), "Annulé.")}
          >
            Annuler
          </button>
        )}
      </article>
    );
  }

  const blockers = [
    ...(p.mail === null
      ? ["le mail n'est plus sur le serveur (ce brouillon sera clos à la prochaine relève)"]
      : []),
    ...(p.mail !== null && p.mail.to === null ? ["l'adresse de l'expéditeur est illisible"] : []),
    ...(leftSlots.length > 0 ? [`case${leftSlots.length > 1 ? "s" : ""} à compléter`] : []),
    ...(dirty ? ["enregistre d'abord ta modification"] : []),
  ];

  return (
    <article className="proposal" aria-label={`Brouillon ${p.id}`}>
      <header>
        <strong>{p.mail?.subject ?? "(mail introuvable)"}</strong>
        <span className="from">{p.mail?.fromName}</span>
        <span className="to" title="Imposé : toujours l'expéditeur du mail">
          À : {p.mail?.to ?? "—"} <span className="lock">🔒</span>
        </span>
      </header>
      <ul className="flags">
        {p.mail?.replyToElsewhere && (
          <li className="red">
            Ce mail demande qu'on réponde à une autre adresse : ignoré, la réponse ira à
            l'expéditeur.
          </li>
        )}
        {leftSlots.length > 0 && (
          <li className="red">À compléter : {leftSlots.map((s) => `{${s} ?}`).join(" ")}</li>
        )}
        {p.unsupported.length > 0 && (
          <li className="red">Absent du fil, à vérifier : {p.unsupported.join(" · ")}</li>
        )}
      </ul>
      <label className="draft-label">
        Brouillon {p.trame !== null && <span className="trame">({p.trame})</span>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          maxLength={5000}
        />
      </label>
      <div className="actions">
        {dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => saveDraft(token, p.id, text), "Modification enregistrée.")}
          >
            Enregistrer
          </button>
        )}
        <button
          type="button"
          className="accept"
          disabled={busy || blockers.length > 0}
          title={blockers.join(" · ")}
          onClick={() => run(() => act(token, p.id, "accept"), "Accepté : 2 minutes pour annuler.")}
        >
          Accepter
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => act(token, p.id, "refuse"), "Refusé : il ne reviendra pas.")}
        >
          Refuser
        </button>
      </div>
      {blockers.length > 0 && <p className="detail">Accepter : {blockers.join(" · ")}</p>}
    </article>
  );
}

export function Proposals({
  token,
  onLost,
}: {
  readonly token: string;
  readonly onLost: () => void;
}) {
  const [items, setItems] = useState<ProposalView[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listProposals(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        forgetToken();
        onLost();
        return;
      }
      setMessage("Impossible de charger les brouillons : le serveur répond-il ?");
    }
  }, [token, onLost]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section id="brouillons" className="proposals" aria-label="Brouillons à valider">
      <h2>Brouillons à valider</h2>
      {message !== null && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {items === null ? (
        <p className="detail">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="detail">Aucun brouillon en attente.</p>
      ) : (
        items.map((p) => (
          <Card
            key={`${p.id}-${p.status}-${p.draft.length}`}
            p={p}
            token={token}
            onDone={(m) => {
              setMessage(m);
              void load();
            }}
          />
        ))
      )}
    </section>
  );
}
