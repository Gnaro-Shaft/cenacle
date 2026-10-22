/**
 * The Telegram alert of the prospection agent (ADR-0032, point 19): numbers
 * and fixed words only, never a mission's text; sent only when cards from a
 * mail reached « alert » since the last message that left. "Said" is the
 * journal's prospection.alert_sent, written only once the message is gone:
 * a failed send writes nothing of it, and the next pass says it again.
 */
export interface AlertCounts {
  /** Stopped this pass before « Client direct », then before « Mon profil ». */
  readonly detected: number;
  readonly direct: number;
  /** Alerts left unread by the article 9 floor: to read myself. */
  readonly floor: number;
}

export function alertText(n: number, c: AlertCounts): string {
  const s = n > 1 ? "s" : "";
  const lines = [
    `📋 Prospection — ${n} nouvelle${s} mission${s} pour toi, à lire sur la page.`,
    "Relevé et tri par IA : à vérifier.",
  ];
  if (c.detected + c.direct > 0) {
    lines.push(`Arrêtées : ${c.detected} intermédiaire ou doute · ${c.direct} hors profil`);
  }
  if (c.floor > 0) {
    lines.push(
      `${c.floor} alerte${c.floor > 1 ? "s" : ""} non lue${c.floor > 1 ? "s" : ""} (données sensibles) : à lire toi-même.`,
    );
  }
  return lines.join("\n");
}

export interface AlertDeps {
  /** When the last alert left (the journal), or null: never. */
  readonly lastSent: () => Promise<Date | null>;
  /** Cards from a mail placed in « alert » after that instant. */
  readonly newAlerts: (since: Date | null) => Promise<number>;
  readonly send: (text: string) => Promise<void>;
  /** A sending failure (Telegram unreachable, refused): said, retried next pass. */
  readonly sendFailure: (error: unknown) => string | null;
  readonly journal: {
    append(e: { agent: string; type: string; payload?: Record<string, unknown> }): Promise<unknown>;
  };
  readonly counts: AlertCounts;
}

export type AlertOutcome = "sent" | "nothing" | "failed";

export async function alertIfNew(deps: AlertDeps): Promise<AlertOutcome> {
  const n = await deps.newAlerts(await deps.lastSent());
  if (n === 0) return "nothing";
  try {
    await deps.send(alertText(n, deps.counts));
  } catch (error) {
    const kind = deps.sendFailure(error);
    if (kind === null) throw error; // not a sending failure: a bug, never swallowed
    await deps.journal.append({
      agent: "prospection",
      type: "prospection.alert_failed",
      payload: { kind },
    });
    return "failed";
  }
  await deps.journal.append({
    agent: "prospection",
    type: "prospection.alert_sent",
    payload: { count: n },
  });
  return "sent";
}
