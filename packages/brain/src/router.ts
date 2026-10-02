/**
 * Decides where a task may be sent (ADR-0003). Code, not the model, decides.
 *
 * - Anything touching mail content or personal data goes to the LOCAL model, full stop.
 * - The EU API is allowed only for tasks with no personal data, and only if configured.
 * - If the local model is unavailable, the task waits: there is no silent fallback.
 */

export const DATA_CLASSES = ["mail_content", "personal", "no_personal_data"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];
export type Destination = "local" | "eu_api";

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingError";
  }
}

export interface RouteRequest {
  readonly dataClass: DataClass;
  /** The caller may prefer the EU API; the router decides whether that is allowed. */
  readonly prefer?: Destination;
}

export interface RouterConfig {
  readonly euApiConfigured: boolean;
}

export function route(request: RouteRequest, config: RouterConfig): Destination {
  if (!(DATA_CLASSES as readonly string[]).includes(request.dataClass)) {
    throw new RoutingError(`Unknown data class ${JSON.stringify(request.dataClass)}`);
  }
  if (request.prefer === "eu_api") {
    if (request.dataClass !== "no_personal_data") {
      throw new RoutingError(`${request.dataClass} may only be processed by the local model`);
    }
    if (!config.euApiConfigured) {
      throw new RoutingError("The EU API is not configured");
    }
    return "eu_api";
  }
  return "local";
}
