import type { MailCounts } from "@cenacle/core";

const CASES = [
  ["clients_prospects", "Clients"],
  ["administratif", "Administratif"],
  ["bruit", "Bruit"],
  ["missions", "Missions"],
  ["a_trier", "À trier"],
] as const;

/** The mails Iris remembers, per category: five numbers, no content. */
export function MailCounters({ counts }: { readonly counts: MailCounts }) {
  return (
    <div className="courrier">
      <h4>Courrier</h4>
      <dl aria-label="Courrier suivi par Iris">
        {CASES.map(([key, label]) => (
          <div key={key} className={`compte ${key}`}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
      {(counts.due > 0 || counts.waiting > 0) && (
        <p className="relances">
          Relances :{" "}
          {counts.due > 0 && (
            <span className="echue">
              {counts.due} échue{counts.due > 1 ? "s" : ""}
            </span>
          )}
          {counts.due > 0 && counts.waiting > 0 && " · "}
          {counts.waiting > 0 && <span>{counts.waiting} en attente</span>}
        </p>
      )}
      {counts.pending > 0 && <p className="detail">{counts.pending} en cours de tri</p>}
    </div>
  );
}
