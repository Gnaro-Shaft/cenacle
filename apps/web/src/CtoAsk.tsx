import { useState } from "react";
import { ApiError, askCto, type CtoReplyView } from "./api.ts";

/** The longest question the CTO accepts (packages/cto, MAX_QUESTION). */
const MAX_QUESTION = 2000;

/**
 * Ask the CTO (ADR-0020). The answer is shown as plain text: React escapes it,
 * so nothing the model writes is ever read as HTML. Nothing is kept: neither
 * the question nor the answer is stored, not even in the browser.
 */
export function CtoAsk({ token, onLost }: { readonly token: string; readonly onLost: () => void }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [reply, setReply] = useState<CtoReplyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setPending(true);
    setError(null);
    setReply(null);
    try {
      setReply(await askCto(token, question));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLost();
      setError(e instanceof Error ? e.message : "erreur");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="proposals" aria-label="Demander au CTO">
      <h2>Demander au CTO</h2>
      <div className="proposal">
        <label className="draft-label" htmlFor="cto-question">
          Ta question technique (aucune donnée de client ni contenu de mail)
        </label>
        <textarea
          id="cto-question"
          rows={3}
          maxLength={MAX_QUESTION}
          value={question}
          disabled={pending}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="actions">
          <button
            type="button"
            className="accept"
            disabled={pending || question.trim() === ""}
            onClick={ask}
          >
            {pending ? "Le CTO réfléchit… (1 à 3 min)" : "Demander"}
          </button>
        </div>
        {error !== null && <p className="message">🛑 {error}</p>}
        {reply !== null && (
          <>
            <div className="draft-text" aria-live="polite">
              {reply.text}
            </div>
            {reply.cut && (
              <p className="message">
                ⚠ Réponse coupée à la limite de longueur : demande-lui d'approfondir un point
                précis.
              </p>
            )}
            <p className="detail">
              {reply.summary} — {reply.seconds} s, modèle local. Un avis à vérifier, pas un fait
              établi.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
