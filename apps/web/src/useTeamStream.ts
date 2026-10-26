import type { AgentMessage } from "@cenacle/core";
import { useEffect, useState } from "react";

export type StreamState =
  | { readonly kind: "connecting" }
  | { readonly kind: "offline" }
  | AgentMessage;

/**
 * Follows the whole team's live status over one Server-Sent Events stream
 * (2026-10-26). One stream per card took six of the browser's six
 * connections to the page's address: its other calls — missions, drafts,
 * the CTO — waited forever. An agent's problem stops that agent alone.
 */
export function useTeamStream(agents: readonly string[]): ReadonlyMap<string, StreamState> {
  const key = agents.join(",");
  const [states, setStates] = useState<ReadonlyMap<string, StreamState>>(
    () => new Map(agents.map((agent) => [agent, { kind: "connecting" }])),
  );

  useEffect(() => {
    const team = key.split(",");
    const source = new EventSource(
      `/api/agents/stream?agents=${team.map(encodeURIComponent).join(",")}`,
    );
    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as AgentMessage;
      if (!team.includes(message.agent)) return;
      setStates((previous) => {
        const next = new Map(previous).set(message.agent, message);
        // Every agent stopped on a problem: the server ended the stream, a human must look.
        if (team.every((agent) => next.get(agent)?.kind === "problem")) source.close();
        return next;
      });
    };
    source.addEventListener("status", onMessage);
    source.addEventListener("problem", onMessage);
    source.onerror = () => {
      if (source.readyState === EventSource.OPEN) return;
      setStates(
        (previous) =>
          new Map(
            [...previous].map(([agent, state]) => [
              agent,
              state.kind === "problem" ? state : { kind: "offline" },
            ]),
          ),
      );
    };
    return () => source.close();
  }, [key]);

  return states;
}
