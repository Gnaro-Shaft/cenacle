/**
 * The token of this run of the server (phase 4, B3). It arrives in the link
 * the server prints (`#jeton=…`: the part after # is never sent over the
 * network), is kept for this tab only, and removed from the address bar.
 */
const KEY = "cenacle.jeton";
const RULE = /^[A-Za-z0-9_-]{20,128}$/;

export function takeToken(): string | null {
  const match = /(?:^#|&)jeton=([^&]+)/.exec(window.location.hash);
  if (match?.[1] !== undefined && RULE.test(match[1])) {
    try {
      sessionStorage.setItem(KEY, match[1]);
    } catch {
      // Private window: the token lives in memory only, for this page.
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return match[1];
  }
  try {
    const kept = sessionStorage.getItem(KEY);
    return kept !== null && RULE.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function forgetToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing kept
  }
}
