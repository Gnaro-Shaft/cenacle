import type { MailCounts } from "@cenacle/core";

const CASES = [
  ["clients_prospects", "Clients"],
  ["administratif", "Admin"],
  ["bruit", "Bruit"],
  ["a_trier", "À trier"],
] as const;

/** The mails Iris remembers, per category: four numbers, no content. */
export function MailCounters({ counts }: { readonly counts: MailCounts }) {
  return (
    <div className="counters">
      <dl aria-label="Courrier suivi par Iris">
        {CASES.map(([key, label]) => (
          <div key={key} className={`counter ${key}`}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
      {(counts.due > 0 || counts.waiting > 0) && (
        <p className="follow-up">
          {counts.due > 0 && <span className="due">🔔 {counts.due} à relancer</span>}
          {counts.waiting > 0 && <span className="waiting">⏳ {counts.waiting} en attente</span>}
        </p>
      )}
      {counts.pending > 0 && <p className="detail">{counts.pending} en cours de tri</p>}
    </div>
  );
}
