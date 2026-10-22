import type { Ring } from "./presence.ts";

/** Line-art emblems, drawn here: no image, nothing fetched. */
const EMBLEMS = {
  // Iris, the mail: an envelope.
  iris: (
    <>
      <rect className="embleme" x="8.5" y="11" width="15" height="10.5" rx="1" />
      <path className="embleme" d="M9 12 L16 17.5 L23 12" />
    </>
  ),
  // The CTO, who gives the bearing: a compass rose.
  cto: (
    <>
      <circle className="embleme" cx="16" cy="16" r="7" />
      <path className="embleme" d="M16 9.5 V12 M16 20 V22.5 M9.5 16 H12 M20 16 H22.5" />
      <path className="embleme" d="M18.5 13.5 L15 15 L13.5 18.5 L17 17 Z" />
    </>
  ),
  // The prospector, who looks out for missions: a magnifying glass.
  prospection: (
    <>
      <circle className="embleme" cx="14.5" cy="14.5" r="5.5" />
      <path className="embleme" d="M18.5 18.5 L23 23" />
    </>
  ),
} as const;

export type Emblem = keyof typeof EMBLEMS;

/** The ring says the state by its colour; the card says it again in words. */
export function Avatar({ emblem, ring }: { readonly emblem: Emblem; readonly ring: Ring }) {
  return (
    <svg className={`avatar anneau-${ring}`} viewBox="0 0 32 32" aria-hidden="true">
      <circle className="anneau" cx="16" cy="16" r="14.5" />
      {EMBLEMS[emblem]}
    </svg>
  );
}
