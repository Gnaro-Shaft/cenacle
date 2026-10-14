import type { MailCounts } from "@cenacle/core";
import { Avatar, type Emblem } from "./Avatar.tsx";
import { MailCounters } from "./MailCounters.tsx";
import { presence, type Visual } from "./presence.ts";

export interface AgentCardProps {
  readonly title: string;
  readonly duty: string;
  readonly emblem: Emblem;
  readonly visual: Visual;
  readonly pending: number;
  readonly detail: string | null;
  readonly mail: MailCounts | null;
}

/** One agent in the team panel: its emblem in its ring, its state in words. */
export function AgentCard({ title, duty, emblem, visual, pending, detail, mail }: AgentCardProps) {
  const { ring, label } = presence(visual, pending);
  return (
    <article className={`agent etat-${ring}`} aria-label={`${title}, ${label}`}>
      <div className="agent-tete">
        <Avatar emblem={emblem} ring={ring} />
        <div>
          <h3>{title}</h3>
          <p className="etat">{label}</p>
          <p className="role">{duty}</p>
        </div>
      </div>
      {pending > 0 && (
        <a className="a-decider" href="#brouillons">
          {pending} brouillon{pending > 1 ? "s" : ""} à décider
        </a>
      )}
      {detail !== null && <p className="detail">{detail}</p>}
      {mail !== null && <MailCounters counts={mail} />}
    </article>
  );
}
