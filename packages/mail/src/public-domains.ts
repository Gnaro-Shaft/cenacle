/**
 * Public domains, for the leak measure (M2, mesure:fuites): a sender's domain
 * may also be a site Cénacle reads public pages from — a platform that writes
 * to me and whose releases the veille follows. Its links then sit in the
 * veille's articles and the security findings, by construction, with no mail
 * involved (measured on 2026-10-21: 36 rows, each time inside a link only).
 *
 * Public means declared: the hosts of the URLs in Cénacle's versioned
 * configuration (veille.toml, securite.toml). Only links *to* such a domain
 * are set aside; the domain anywhere else — an address, free text, a link to
 * another host — is still a leak.
 */

/** The hosts of every http(s) URL in these texts, lower case. */
export function declaredHosts(texts: readonly string[]): Set<string> {
  const hosts = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = (m[1] as string).toLowerCase().replace(/\.+$/, "");
      if (host.includes(".")) hosts.add(host);
    }
  }
  return hosts;
}

/** A sender domain is public when a declared host is that domain or one of its subdomains. */
export function isPublicDomain(domain: string, hosts: ReadonlySet<string>): boolean {
  const d = domain.trim().toLowerCase().replace(/\.+$/, "");
  if (!d.includes(".")) return false;
  for (const host of hosts) if (host === d || host.endsWith(`.${d}`)) return true;
  return false;
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text without its links to `domain` (or its subdomains): scheme, host,
 * port, path. A host that only starts like it (`domain.evil.example`), or the
 * domain written as a link's user (`https://domain@evil.example`), is no link
 * to it and stays.
 */
export function withoutLinksTo(text: string, domain: string): string {
  const d = literal(domain.trim().toLowerCase().replace(/\.+$/, ""));
  const link = new RegExp(
    `https?:(?:\\\\?/){2}(?:[a-z0-9-]+\\.)*${d}(?![a-z0-9.@-])(?::\\d+)?(?:[/?#][^\\s"'<>\\\\]*)?`,
    "gi",
  );
  return text.replace(link, " ");
}
