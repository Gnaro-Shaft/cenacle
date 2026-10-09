/**
 * Opens the validation page with its token (ADR-0019). Usage: npm run page
 *
 * The server writes the link to a file only I can read; this opens it in the
 * browser, and never prints it: the token goes from the file to the browser.
 */
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { refuseForeignSecrets } from "@cenacle/core";
import { PageUrlError, pageUrlPath, readPageUrl } from "@cenacle/server/page-url";

refuseForeignSecrets("L'ouverture de la page", []);
try {
  const url = readPageUrl(pageUrlPath(homedir()), userInfo().uid);
  execFile("/usr/bin/open", [url], (error) => {
    if (error !== null) {
      console.error("🛑 le navigateur n'a pas pu être ouvert");
      process.exitCode = 1;
      return;
    }
    console.log("✔ Page ouverte dans le navigateur.");
  });
} catch (error) {
  console.error(`🛑 ${error instanceof PageUrlError ? error.message : "erreur"}`);
  process.exitCode = 1;
}
