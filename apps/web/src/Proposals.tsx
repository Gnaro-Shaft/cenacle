/**
 * The drafts waiting for me (phase 4, B3). Each one shows its imposed
 * recipient (not editable), its red flags, the text I can edit, and
 * Accept / Refuse. Accept stays locked while a slot is left, while my edit
 * is not saved, or when the recipient cannot be read, and it carries the
 * text I was shown. Refusing asks once more: it is final. Once accepted, I
 * have the box's undo delay to cancel. The rules live in proposal-rules.ts.
 * Nothing is sent from here: the executor does it (B4).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, accept, act, listProposals, type ProposalView, saveDraft } from "./api.ts";
import {
  acceptBlockers,
  acceptBody,
  acceptedMessage,
  countdown,
  type RefuseClick,
  type RefuseStep,
  realRecipientWarning,
  refuseStep,
  slotsLeft,
} from "./proposal-rules.ts";
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

export function Card({
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
  const [refusing, setRefusing] = useState<RefuseStep>("idle");
  const now = useNow(1000);
  const dirty = text !== p.draft;
  const leftSlots = slotsLeft(text);

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
            ? "Envoi en cours…"
            : "✕ L'envoi a échoué. Il n'est jamais réessayé tout seul : réponds depuis ta messagerie si besoin."}
        </p>
      </article>
    );
  }

  if (p.status === "accepted") {
    const { left, text: line } = countdown(p.sendAfter, now);
    return (
      <article className="proposal accepted" aria-label={`Brouillon accepté ${p.id}`}>
        <header>
          <strong>{p.mail?.subject ?? "(mail introuvable)"}</strong>
          <span className="to">À : {p.mail?.to ?? "—"}</span>
        </header>
        <pre className="draft-text">{p.draft}</pre>
        <p className="countdown">{line}</p>
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

  const blockers = acceptBlockers(p, text);
  const onRefuse = (click: RefuseClick) => {
    const next = refuseStep(refusing, click);
    setRefusing(next.step);
    if (next.send) void run(() => act(token, p.id, "refuse"), "Refusé : il ne reviendra pas.");
  };

  return (
    <article className="proposal" aria-label={`Brouillon ${p.id}`}>
      <header>
        <strong>{p.mail?.subject ?? "(mail introuvable)"}</strong>
        <span className="from">{p.mail?.fromName}</span>
        <span className="to" title="Imposé : toujours l'expéditeur du mail">
          À : {p.mail?.to ?? "—"} <span className="lock">(imposé)</span>
        </span>
      </header>
      <ul className="flags">
        {p.delivery === "real" && <li className="red">{realRecipientWarning(p.undoMinutes)}</li>}
        {p.delivery === "my_list" && (
          <li>Envoi limité à ta liste fermée : rien ne partira chez un correspondant.</li>
        )}
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
      {refusing === "confirming" ? (
        <fieldset className="actions confirm">
          <legend className="confirm-refus">
            Refuser définitivement ? Ce brouillon ne reviendra pas, et rien ne partira.
          </legend>
          <button type="button" disabled={busy} onClick={() => onRefuse("confirm")}>
            Oui, refuser
          </button>
          <button type="button" disabled={busy} onClick={() => onRefuse("keep")}>
            Garder
          </button>
        </fieldset>
      ) : (
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
            onClick={() =>
              run(() => accept(token, p.id, acceptBody(p)), acceptedMessage(p.undoMinutes))
            }
          >
            Accepter
          </button>
          <button type="button" disabled={busy} onClick={() => onRefuse("refuse")}>
            Refuser…
          </button>
        </div>
      )}
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

  // Red only when something waits on me (the spirit of Myriade).
  const waiting = items?.filter((p) => p.status === "pending").length ?? 0;
  return (
    <section
      id="brouillons"
      className={waiting > 0 ? "bloc decide" : "bloc"}
      aria-label="Brouillons à décider"
    >
      <div className="bloc-titre">
        <h2>À décider</h2>
        {waiting > 0 && (
          <span className="compte-rouge">
            {waiting} brouillon{waiting > 1 ? "s" : ""}
          </span>
        )}
      </div>
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
            // A new text, even of the same length, is a new card: a refusal
            // question left open never applies to a text I have not seen.
            key={`${p.id}-${p.status}-${p.draft}`}
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
