/**
 * The Parc's « Sauvegardes » section (ADR-0043, S2b): one line per machine
 * and source, in the ronde's words (parc-backups.ts). A source ill or
 * unreadable gives the command that reads its motifs on the server — the
 * page never shows them. Plain text everywhere (React escapes it).
 */
import type { ParcView } from "./api.ts";
import { backupsSection } from "./parc-backups.ts";
import type { Tone } from "./parc-rules.ts";

const TONE_LABEL: Readonly<Record<Tone, string>> = {
  bon: "saine",
  attention: "à surveiller",
  mauvais: "en défaut",
  inconnu: "inconnue",
};

export function Backups({ view, now }: { readonly view: ParcView; readonly now: number }) {
  const section = backupsSection(view, now);
  return (
    <article className={`bloc parc-carte ton-cadre-${section.tone}`} aria-label="Sauvegardes">
      <h2>Sauvegardes</h2>
      {section.note !== null && <p className="parc-note perime">{section.note}</p>}
      {section.lines.length > 0 && (
        <ul className="parc-lignes sauvegardes">
          {section.lines.map((l) => (
            <li key={`${l.machine}-${l.source ?? "bulletin"}`} className="parc-ligne">
              <span
                className={`point ton-${l.tone}`}
                role="img"
                aria-label={l.judged ? TONE_LABEL[l.tone] : "non jugée"}
              />
              <span className="parc-nom">
                {l.machine}
                {l.source !== null && <span className="parc-etiquette"> · {l.source}</span>}
              </span>
              <span className="parc-valeur sauvegarde-mots">{l.words}</span>
              {/* On its own row: a long command never crushes the machine's name. */}
              {l.command !== null && (
                <span className="sauvegarde-commande">
                  à lire sur le serveur : <code>{l.command}</code>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
