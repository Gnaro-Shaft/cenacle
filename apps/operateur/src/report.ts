/**
 * What `npm run serveurs:verifier` says about serveurs.local.toml (ADR-0027):
 * readable, with each machine and the actions it holds a key for — or exactly
 * what the operator would refuse, block number included. Never an address, a
 * key path or a known_hosts path: those stay in the file.
 */
import { parseServers, ServersConfigError } from "@cenacle/securite";

export interface ServersReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export function serversReport(text: string | null): ServersReport {
  if (text === null) {
    return { ok: false, lines: ["🛑 serveurs.local.toml est absent."] };
  }
  try {
    const { servers } = parseServers(text);
    const lines = servers.map((s) => {
      const actions = Object.keys(s.keys);
      return `   ${s.name} : ${actions.length > 0 ? actions.join(", ") : "aucune clé"}`;
    });
    return {
      ok: true,
      lines: [`✅ serveurs.local.toml est lisible : ${servers.length} machine(s).`, ...lines],
    };
  } catch (error) {
    if (!(error instanceof ServersConfigError)) throw error;
    return {
      ok: false,
      lines: [`🛑 L'opérateur refuserait ce fichier (${error.problem}) :`, `   ${error.message}`],
    };
  }
}
