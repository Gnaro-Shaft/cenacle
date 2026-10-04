/**
 * Which domains write to me, and which I write to (phase 5, M2) — to help me
 * write regles.local.toml. Pure: headers in, counts out. Domains only: no
 * address, no name, no subject ever leaves this function.
 *
 * - A sender is read with the same strict reading as the postman: an
 *   ambiguous From (two addresses, a group) counts for nothing.
 * - A person on the opposition list (C3) is skipped: their mails are not read.
 * - Mass-market mailboxes are flagged: a rule on gmail.com would sort everyone.
 */
import { addressList, senderAddress } from "./sender-domain.ts";

/** Mass-market mailboxes (France and worldwide): never a rule. */
export const MASS_MARKET: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "bbox.fr",
  "laposte.net",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.fr",
  "gmx.com",
  "aol.com",
  "numericable.fr",
]);

export interface SentHeaders {
  readonly to: string | null;
  readonly cc: string | null;
}

export interface DomainCount {
  readonly domain: string;
  /** Mails received from it. */
  readonly received: number;
  /** Mails I sent to it (one per mail, however many recipients there). */
  readonly sent: number;
  readonly massMarket: boolean;
  /** My own domain: mails between my addresses. */
  readonly mine: boolean;
}

export interface CensusInput {
  /** The From header of each received mail, as fetched. */
  readonly inbox: readonly (string | null)[];
  readonly sent: readonly SentHeaders[];
  /** True for an address on the opposition list. */
  readonly isOpposed: (address: string) => boolean;
  readonly myDomain: string | null;
}

export interface Census {
  readonly domains: DomainCount[];
  /** From headers that could not be read unambiguously. */
  readonly unreadable: number;
  /** Mails skipped because their sender (or a recipient) is opposed. */
  readonly opposed: number;
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

export function censusDomains(input: CensusInput): Census {
  const received = new Map<string, number>();
  const sent = new Map<string, number>();
  let unreadable = 0;
  let opposed = 0;
  for (const from of input.inbox) {
    const address = senderAddress(from);
    if (address === null) {
      unreadable += 1;
      continue;
    }
    if (input.isOpposed(address)) {
      opposed += 1;
      continue;
    }
    const d = domainOf(address);
    received.set(d, (received.get(d) ?? 0) + 1);
  }
  for (const mail of input.sent) {
    const all = [...addressList(mail.to, "to"), ...addressList(mail.cc, "cc")];
    const kept = all.filter((a) => !input.isOpposed(a));
    if (kept.length < all.length) opposed += 1;
    for (const d of new Set(kept.map(domainOf))) sent.set(d, (sent.get(d) ?? 0) + 1);
  }
  const myDomain = input.myDomain?.toLowerCase() ?? null;
  const domains = [...new Set([...received.keys(), ...sent.keys()])].map((domain) => ({
    domain,
    received: received.get(domain) ?? 0,
    sent: sent.get(domain) ?? 0,
    massMarket: MASS_MARKET.has(domain),
    mine: domain === myDomain,
  }));
  domains.sort(
    (a, b) => b.received + b.sent - (a.received + a.sent) || a.domain.localeCompare(b.domain),
  );
  return { domains, unreadable, opposed };
}
