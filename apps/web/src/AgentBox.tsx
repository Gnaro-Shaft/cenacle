import type { MailCounts, ViewNote } from "@cenacle/core";
import { AgentCard } from "./AgentCard.tsx";
import type { Emblem } from "./Avatar.tsx";
import type { Visual } from "./presence.ts";
import type { StreamState } from "./useTeamStream.ts";

const NOTES: Record<ViewNote, string> = {
  waiting_for_mac: "en attente du Mac",
  purge_failed: "purge en échec : les durées de conservation ne sont pas tenues",
  auth_missing: "authentification des expéditeurs introuvable : aucun mail n'est rangé client",
};

interface Props {
  /** Its part of the team's one stream (useTeamStream). */
  readonly stream: StreamState;
  readonly title: string;
  readonly duty: string;
  readonly emblem: Emblem;
}

/** An agent, live: its stream turned into what the card shows. */
export function AgentBox({ stream, title, duty, emblem }: Props) {
  let visual: Visual = "offline";
  let detail: string | null = null;
  let pending = 0;
  let mail: MailCounts | null = null;
  if (stream.kind === "status") {
    visual = stream.visual;
    detail = stream.note === null ? null : NOTES[stream.note];
    pending = stream.pendingApprovals;
    mail = stream.mail;
  } else if (stream.kind === "problem") {
    visual = "sick";
    detail = stream.message;
  } else if (stream.kind === "connecting") {
    detail = "connexion…";
  } else {
    detail = "le serveur ne répond pas";
  }

  return (
    <AgentCard
      title={title}
      duty={duty}
      emblem={emblem}
      visual={visual}
      pending={pending}
      detail={detail}
      mail={mail}
    />
  );
}
