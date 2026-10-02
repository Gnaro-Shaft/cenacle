import type { AgentMessage } from "@cenacle/core";
import { useEffect, useState } from "react";

export type StreamState =
  | { readonly kind: "connecting" }
  | { readonly kind: "offline" }
  | AgentMessage;

/** Follows an agent's live status over Server-Sent Events. */
export function useAgentStream(agent: string): StreamState {
  const [state, setState] = useState<StreamState>({ kind: "connecting" });

  useEffect(() => {
    const source = new EventSource(`/api/agents/${encodeURIComponent(agent)}/stream`);
    const onMessage = (event: MessageEvent<string>) => {
      setState(JSON.parse(event.data) as AgentMessage);
    };
    source.addEventListener("status", onMessage);
    source.addEventListener("problem", (event) => {
      onMessage(event);
      source.close(); // the server stopped: a human must look at it
    });
    source.onerror = () => {
      if (source.readyState !== EventSource.OPEN) setState({ kind: "offline" });
    };
    return () => source.close();
  }, [agent]);

  return state;
}
