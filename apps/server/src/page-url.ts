/**
 * The page's link, with its token (ADR-0019). Under launchd there is no
 * terminal: the token must never reach the console, hence the log. It is
 * written to a file only I can read (0600, in a 0700 folder), once the server
 * listens, and removed when it stops cleanly. `npm run page` opens it.
 */
import {
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** The only link ever written: the local page, its token in the fragment (never sent to a server). */
export const PAGE_URL = /^http:\/\/127\.0\.0\.1:5173\/#jeton=[A-Za-z0-9_-]{43}$/;

export function pageUrlPath(home: string): string {
  return join(home, "Library", "Application Support", "cenacle", "page-url");
}

export function pageUrl(token: string): string {
  const url = `http://127.0.0.1:5173/#jeton=${token}`;
  if (!PAGE_URL.test(url)) throw new Error("malformed page token");
  return url;
}

/** Writes the link atomically: never a half-written or world-readable file. */
export function writePageUrl(path: string, url: string): void {
  if (!PAGE_URL.test(url)) throw new Error("malformed page link");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${url}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

/** Removes the link, but only if it is still this server's: a newer one is left alone. */
export function removePageUrl(path: string, url: string): void {
  try {
    if (readFileSync(path, "utf8").trim() === url) rmSync(path, { force: true });
  } catch {
    // Already gone: nothing to remove.
  }
}

export class PageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageUrlError";
  }
}

/**
 * Reads the link back, refusing anything that is not exactly what the server
 * writes: a link, a symlink, a file others can read or that is not mine.
 */
export function readPageUrl(path: string, uid: number): string {
  let fd: number;
  try {
    if (lstatSync(path).isSymbolicLink())
      throw new PageUrlError("le lien de la page est un lien symbolique : refusé");
    fd = openSync(path, "r");
  } catch (error) {
    if (error instanceof PageUrlError) throw error;
    throw new PageUrlError(
      "aucun lien de page : le serveur tourne-t-il ? (npm run service -- status server)",
    );
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new PageUrlError("le lien de la page n'est pas un fichier : refusé");
    if (stat.uid !== uid) throw new PageUrlError("le lien de la page n'est pas à toi : refusé");
    if ((stat.mode & 0o077) !== 0)
      throw new PageUrlError("le lien de la page est lisible par d'autres : refusé");
    if (stat.size > 200) throw new PageUrlError("le lien de la page est trop long : refusé");
    const url = readFileSync(fd, "utf8").trim();
    if (!PAGE_URL.test(url)) throw new PageUrlError("le lien de la page est malformé : refusé");
    return url;
  } finally {
    closeSync(fd);
  }
}
