import type { ViewNote, VisualState } from "@cenacle/core";
import { useAgentStream } from "./useAgentStream.ts";

const LABELS: Record<VisualState | "offline", string> = {
  resting: "au repos",
  working: "en activité",
  sick: "malade",
  offline: "hors ligne",
};

const NOTES: Record<ViewNote, string> = {
  waiting_for_mac: "en attente du Mac",
};

interface Props {
  readonly agent: string;
  readonly title: string;
  readonly duty: string;
}

export function AgentBox({ agent, title, duty }: Props) {
  const stream = useAgentStream(agent);

  let visual: VisualState | "offline" = "offline";
  let detail: string | null = null;
  let pending = 0;
  if (stream.kind === "status") {
    visual = stream.visual;
    detail = stream.note === null ? null : NOTES[stream.note];
    pending = stream.pendingApprovals;
  } else if (stream.kind === "problem") {
    visual = "sick";
    detail = stream.message;
  } else if (stream.kind === "connecting") {
    detail = "connexion…";
  } else {
    detail = "le serveur ne répond pas";
  }

  return (
    <article className={`box ${visual}`} aria-label={`${title}, ${LABELS[visual]}`}>
      {pending > 0 && (
        <button type="button" className="bubble" aria-label={`${pending} validation(s) en attente`}>
          {pending}
        </button>
      )}
      <div className="character" aria-hidden="true">
        <div className="head">
          <span className="eye left" />
          <span className="eye right" />
          <span className="mouth" />
        </div>
        <div className="scarf" />
        {visual === "working" && <span className="gear">⚙</span>}
        {visual === "sick" && <span className="thermometer">🌡</span>}
      </div>
      <h2>{title}</h2>
      <p className="duty">{duty}</p>
      <p className="state">{LABELS[visual]}</p>
      {detail !== null && <p className="detail">{detail}</p>}
    </article>
  );
}
