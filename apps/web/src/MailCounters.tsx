import type { MailCounts } from "@cenacle/core";

const CASES = [
  ["clients_prospects", "Clients"],
  ["administratif", "Admin"],
  ["bruit", "Bruit"],
  ["a_trier", "À trier"],
] as const;

/** How the last collection pass was sorted: four numbers, no content. */
export function MailCounters({ counts }: { readonly counts: MailCounts }) {
  return (
    <div className="counters">
      <dl aria-label="Dernier tri du courrier">
        {CASES.map(([key, label]) => (
          <div key={key} className={`counter ${key}`}>
            <dt>{label}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
      {counts.pending > 0 && <p className="detail">{counts.pending} en cours de tri</p>}
    </div>
  );
}
