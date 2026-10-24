/**
 * The board of missions (ADR-0032, points 14 to 20). Every text is plain
 * text (React escapes it); a link is clickable only in https; a mail's card
 * says it was extracted by AI. I move a card into any column; the agent
 * placed it once and never moves it again.
 */
import { useCallback, useEffect, useState } from "react";
import { AddCard } from "./AddCard.tsx";
import { ApiError, type CardView, listCards, moveCard, type ToRead } from "./api.ts";
import {
  aiMark,
  byColumn,
  COLUMNS,
  CONFIRMED,
  clickable,
  columnLabel,
  deciderLabel,
  rateLabel,
  reasonLabel,
  remoteLabel,
  toReadLabel,
} from "./board-rules.ts";
import { forgetToken } from "./token.ts";

const REFRESH_MS = 30_000;

function MissionCard({
  card,
  onMove,
}: {
  readonly card: CardView;
  readonly onMove?: (id: number, column: string) => void;
}) {
  const link = clickable(card.link);
  const ai = aiMark(card.source);
  const reason = reasonLabel(card.reason);
  return (
    <article className="carte-mission" aria-label={card.title}>
      <h4>{card.title}</h4>
      <p className="detail">
        {card.company ?? "entreprise non dite"}
        {card.place !== null && ` · ${card.place}`}
      </p>
      <p className="detail">
        {rateLabel(card.rate)} · {remoteLabel(card.remote)}
      </p>
      {card.stack.length > 0 && <p className="stack">{card.stack.join(" · ")}</p>}
      {card.note !== null && <p className="note">{card.note}</p>}
      {card.applied !== null && (
        <p className="note">candidature envoyée (voir la carte en Candidature)</p>
      )}
      <p className="marques">
        {ai !== null && <span className="marque-ia">{ai}</span>}
        {card.toCheck && <span className="marque-verifier">à vérifier</span>}
        {reason !== null && <span className="marque-raison">arrêtée : {reason}</span>}
        {card.reason === CONFIRMED && (
          <span className="marque-raison">candidature confirmée par la plateforme</span>
        )}
        <span className="marque-decideur">{deciderLabel(card.decidedBy, card.source)}</span>
      </p>
      {link !== null ? (
        <a href={link} target="_blank" rel="noopener noreferrer nofollow">
          voir l'annonce{card.platform !== null ? ` (${card.platform})` : ""}
        </a>
      ) : (
        card.link !== null && <p className="detail">lien non sûr, non affiché</p>
      )}
      {onMove !== undefined && (
        <label className="deplacer">
          Déplacer vers{" "}
          <select
            value={card.column}
            onChange={(e) => onMove(card.id, e.currentTarget.value)}
            aria-label={`Déplacer « ${card.title} »`}
          >
            {COLUMNS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

/** The board itself, from cards given: used by the page and by the preview. */
export function BoardView({
  cards,
  onMove,
}: {
  readonly cards: readonly CardView[];
  readonly onMove?: (id: number, column: string) => void;
}) {
  return (
    <div className="tableau">
      {byColumn(cards).map((col) => (
        <section key={col.key} className="colonne" aria-label={col.label}>
          <h3>
            {col.label} <span className="compte">{col.cards.length}</span>
          </h3>
          {col.cards.map((c) => (
            <MissionCard key={`${c.id}-${c.column}`} card={c} {...(onMove ? { onMove } : {})} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function Board({ token, onLost }: { readonly token: string; readonly onLost: () => void }) {
  const [cards, setCards] = useState<CardView[] | null>(null);
  const [toRead, setToRead] = useState<ToRead | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refused = useCallback(
    (error: unknown, what: string) => {
      if (error instanceof ApiError && error.status === 401) {
        forgetToken();
        onLost();
        return;
      }
      setMessage(error instanceof ApiError ? `Refusé : ${error.message}` : what);
    },
    [onLost],
  );

  const load = useCallback(async () => {
    try {
      const board = await listCards(token);
      setCards(board.cards);
      setToRead(board.toRead);
    } catch (error) {
      refused(error, "Impossible de charger le tableau : le serveur répond-il ?");
    }
  }, [token, refused]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const move = async (id: number, column: string) => {
    try {
      await moveCard(token, id, column);
      setMessage(`Carte déplacée vers « ${columnLabel(column)} ».`);
    } catch (error) {
      refused(error, "Le serveur ne répond pas.");
    }
    void load();
  };

  const waiting = cards?.filter((c) => c.column === "alert").length ?? 0;
  const byHand = toRead === null ? null : toReadLabel(toRead.floor, toRead.applications);
  return (
    <section id="missions" className="bloc" aria-label="Missions">
      <div className="bloc-titre">
        <h2>Missions</h2>
        {waiting > 0 && <span className="compte-rouge">{waiting} en alerte</span>}
      </div>
      {byHand !== null && <p className="detail a-lire">{byHand}</p>}
      {message !== null && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      <AddCard
        token={token}
        onDone={(m) => {
          setMessage(m);
          void load();
        }}
        onRefused={(error) => refused(error, "Le serveur ne répond pas.")}
      />
      {cards === null ? (
        <p className="detail">Chargement…</p>
      ) : cards.length === 0 ? (
        <p className="detail">Aucune mission pour l'instant.</p>
      ) : (
        <BoardView cards={cards} onMove={(id, column) => void move(id, column)} />
      )}
    </section>
  );
}
