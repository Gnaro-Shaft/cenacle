/**
 * A mission I spotted myself, added on the fly (ADR-0032, point 16): the same
 * fields as an extracted one, plus a short note. Fields only — never a pasted
 * post: it would carry its author's name and text. The server cleans,
 * checks and sorts it; the page only sends what I typed.
 */
import { type FormEvent, useState } from "react";
import { addCard } from "./api.ts";
import { columnLabel } from "./board-rules.ts";

const NOTE_MAX = 280;

/** "Python, LLM , rag" → ["Python", "LLM", "rag"]: the server checks each word. */
function words(text: string): string[] {
  return text
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w !== "");
}

/** "600-700", "650", "" → [600, 700], [650, 650], null; anything else is sent as is, to be refused. */
function rate(text: string): unknown {
  const t = text.trim();
  if (t === "") return null;
  const m = /^(\d{1,4})\s*(?:[-–à]\s*(\d{1,4}))?$/.exec(t);
  if (m === null) return t;
  const min = Number(m[1]);
  return [min, m[2] === undefined ? min : Number(m[2])];
}

export function AddCard({
  token,
  onDone,
  onRefused,
}: {
  readonly token: string;
  readonly onDone: (message: string) => void;
  readonly onRefused: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const text = (name: string) => String(f.get(name) ?? "");
    setBusy(true);
    try {
      const card = await addCard(token, {
        intitule: text("intitule"),
        entreprise: text("entreprise"),
        intermediaire: text("intermediaire"),
        stack: words(text("stack")),
        tjm: rate(text("tjm")),
        teletravail: text("teletravail"),
        lieu: text("lieu"),
        lien: text("lien").trim(),
        note: text("note"),
      });
      form.reset();
      setOpen(false);
      onDone(`Mission ajoutée, en « ${columnLabel(card.column)} ».`);
    } catch (error) {
      onRefused(error);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="ajouter" onClick={() => setOpen(true)}>
        Ajouter une mission repérée
      </button>
    );
  }
  return (
    <form
      className="ajout-mission"
      onSubmit={(e) => void submit(e)}
      aria-label="Ajouter une mission"
    >
      <p className="detail">
        Les champs seulement : ne colle pas un post entier, il contiendrait le nom et le texte de
        son auteur.
      </p>
      <label>
        Intitulé <input name="intitule" required maxLength={120} />
      </label>
      <label>
        Entreprise{" "}
        <input name="entreprise" maxLength={80} placeholder="jamais le nom d'une personne" />
      </label>
      <label>
        Intermédiaire{" "}
        <select name="intermediaire" defaultValue="inconnu">
          <option value="direct">client direct</option>
          <option value="esn">ESN</option>
          <option value="inconnu">je ne sais pas</option>
        </select>
      </label>
      <label>
        Stack <input name="stack" placeholder="Python, LLM" />
      </label>
      <label>
        TJM <input name="tjm" placeholder="600-700" inputMode="numeric" />
      </label>
      <label>
        Télétravail{" "}
        <select name="teletravail" defaultValue="inconnu">
          <option value="total">total</option>
          <option value="partiel">partiel</option>
          <option value="aucun">sur site</option>
          <option value="inconnu">non dit</option>
        </select>
      </label>
      <label>
        Lieu <input name="lieu" maxLength={60} />
      </label>
      <label>
        Lien <input name="lien" type="url" maxLength={2000} placeholder="https seulement" />
      </label>
      <label>
        Note <textarea name="note" maxLength={NOTE_MAX} rows={2} />
      </label>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Ajouter
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Annuler
        </button>
      </div>
    </form>
  );
}
