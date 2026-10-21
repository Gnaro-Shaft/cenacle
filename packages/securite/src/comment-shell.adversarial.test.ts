// The CTO's word (J6a), as the shell or a reader would take it, since 2026-10-21:
// quotes, backslashes, Markdown emphasis and the shell's expansions hide no
// command, and a file kept in the text never completes one; a dash between
// spaces, a file whose extension is no top-level domain and a capital letter
// opening a line are prose.
import { describe, expect, it } from "vitest";
import { cleanComment } from "./comment.ts";

const RISK = "Le risque est réel.";

describe("quotes and backslashes hide no command", () => {
  it.each([
    // The shell removes them: what runs is the command without them.
    `${RISK} Lance sudo "reboot" maintenant.`,
    `${RISK} Lance su\\do reboot maintenant.`,
    `${RISK} Lance s'u'do reboot maintenant.`,
    `${RISK} Lance s""udo reboot maintenant.`,
    `${RISK} Lance $'sudo' reboot maintenant.`,
    `${RISK} Lance d\\o\\a\\s reboot maintenant.`,
    `${RISK} Lance npm \\install left-pad-test maintenant.`,
    `${RISK} Lance "npm" install left-pad-test maintenant.`,
    `${RISK} Lance npm 'i' left-pad-test maintenant.`,
    `${RISK} Lance "git" "clone" evil.example/repo maintenant.`,
    // A reader skips them: typographic, French, wide or rarer quotes, Markdown emphasis.
    `${RISK} Lance sudo “reboot” maintenant.`,
    `${RISK} Lance sudo « reboot » maintenant.`,
    `${RISK} Lance npm ‘i’ left-pad-test maintenant.`,
    `${RISK} Lance sudo ＂reboot＂ maintenant.`,
    `${RISK} Lance sudo ❝reboot❞ maintenant.`,
    `${RISK} Lance sudo 「reboot」 maintenant.`,
    `${RISK} Lance sudo ″reboot″ maintenant.`,
    `${RISK} Lance sudo **reboot** maintenant.`,
    `${RISK} Lance **sudo** reboot maintenant.`,
    `${RISK} Lance npm *install* left-pad-test maintenant.`,
    `${RISK} Lance sudo _reboot_ maintenant.`,
    // What the shell expands after sudo: the history, a variable.
    `${RISK} Lance sudo !-1 maintenant.`,
    `${RISK} Lance sudo $SHELL maintenant.`,
    `${RISK} Lance sudo "$SHELL" maintenant.`,
    // Judged with its quotes too: without them, « l'npm » would be no word.
    `${RISK} Lance l'npm install left-pad-test maintenant.`,
  ])("%s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });

  it.each([
    "L'agent n'a pas d'accès à l'historique d'un dépôt qu'il n'a pas cloné.",
    "Aujourd'hui, l'outil « npm » installe aussi les dépendances d'un paquet.",
    "D’après l’avis, l’« undici » d’avant 5.28.3 est touché.",
    "Lorsqu'un paquet s'installe, c'est l'utilisateur qui l'exécute.",
    'Le fichier "config.json" contient une clé d\'API.',
    "L'option 'strict' est désactivée dans ce projet.",
    "La clé id_rsa et le module __init__ sont dans le dépôt.",
    "Le score est de 5 * 3 points.",
    // Without its quotes, what follows sudo is punctuation, not a word.
    "Ne lance jamais sudo !",
    "Ne lance jamais « sudo ».",
    "Pourquoi sudo !?",
    "Le groupe « sudo » ~ admin est trop large.",
    "Le droit « sudo » / « admin » est accordé à tous.",
  ])("an apostrophe or a quote in prose stays: %s", (sentence) => {
    expect(cleanComment(sentence)).toBe(sentence);
  });

  it("sudo !! ends its sentence, and the sentence goes", () => {
    expect(cleanComment(`${RISK} Lance sudo !! Puis ferme le terminal.`)).toBe(
      `${RISK} Puis ferme le terminal.`,
    );
  });

  // The broad shape of 2026-10-20: between quotes, sudo is still sudo followed by a word.
  it("« sudo » between French quotes takes its sentence with it", () => {
    expect(cleanComment(`Le terme « sudo » désigne l'élévation de droits. ${RISK}`)).toBe(RISK);
  });
});

describe("what the shell expands to a word or to nothing hides no command", () => {
  it.each([
    `${RISK} Lance s$'u'do reboot maintenant.`,
    `${RISK} Lance $'\\x73udo' reboot maintenant.`,
    `${RISK} Lance su\${x}do reboot maintenant.`,
    `${RISK} Lance sudo\${IFS}reboot maintenant.`,
    `${RISK} Lance s$1udo reboot maintenant.`,
    `${RISK} Lance {sudo,reboot} maintenant.`,
    `${RISK} Lance {rm,-rf,~} maintenant.`,
  ])("%s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });

  it("a price in dollars is no expansion", () => {
    expect(cleanComment("Le service coûte $5 par mois.")).toBe("Le service coûte $5 par mois.");
  });
});

describe("a dash between spaces is no option", () => {
  it.each([
    "Le serveur SSH - ouvert sur Internet - accepte les mots de passe.",
    "Tailscale - ton VPN - est à jour.",
    "Git - ton outil de versions - garde tout l'historique.",
    "Le binaire ssh - celui du système - est ancien.",
    "Le binaire sudo - celui du système - est ancien.",
    "Le binaire curl - celui du système - est ancien.",
    "L'outil « wget » - présent par défaut - est ancien.",
    "Ces réglages - launchctl, defaults - restent à vérifier.",
  ])("%s", (sentence) => {
    expect(cleanComment(sentence)).toBe(sentence);
  });

  it.each([
    `${RISK} Lance ssh -p 22 srv-test-01 maintenant.`,
    `${RISK} Lance tailscale --accept-routes maintenant.`,
    `${RISK} Lance kill -9 1 maintenant.`,
    `${RISK} Lance git -C projet pull maintenant.`,
    `${RISK} Lance sudo -s maintenant.`,
    `${RISK} Lance sudo ./install maintenant.`,
    `${RISK} Lance curl -fsSL srv-test-01 maintenant.`,
    // For rm, a lone dash is a file name: the files after it go.
    `${RISK} Lance rm - projet maintenant.`,
    `${RISK} Lance rm -- projet maintenant.`,
  ])("an option glued to its dash still is one: %s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });
});

describe("a file whose extension is no top-level domain is a file", () => {
  // None of these extensions is a top-level domain (IANA list, version 2026102000).
  it.each([
    "Le fichier cert.pem est lisible par tous.",
    "La clé server.key est versionnée dans le dépôt.",
    "Le fichier index.html expose une clé d'API.",
    "Le fichier pom.xml déclare une dépendance vulnérable.",
    "Le dump base.sql contient des mots de passe.",
    "La feuille style.css charge un script distant.",
    "Le code source de main.go contient un jeton en clair.",
    "Le fichier terraform.tfstate garde des secrets en clair.",
    "L'export clients.csv contient des données de test.",
    "Le coffre vault.kdbx et le profil client.ovpn sont dans le dépôt.",
    "La copie backup.sqlite3 et le certificat CERT.PEM sont publics.",
    "Le patch fix.diff corrige la faille, et le propriétaire de server.key est root.",
    "L'outil sqlite3 lit base.db sans mot de passe.",
  ])("%s", (sentence) => {
    expect(cleanComment(sentence)).toBe(sentence);
  });

  // These are top-level domains: Telegram would turn the name into a link.
  it.each([
    ["Le fichier Main.java est public.", "Le fichier est public."],
    ["Le fichier settings.py est public.", "Le fichier est public."],
    ["La clé id_rsa.pub est publique.", "La clé est publique."],
    ["Le fichier main.tf est public.", "Le fichier est public."],
    ["Le fichier lib.rs est public.", "Le fichier est public."],
    ["Le fichier app.properties est public.", "Le fichier est public."],
    ["Le script deploy.sh est public.", "Le script est public."],
    ["L'archive sauvegarde.zip est publique.", "L'archive est publique."],
  ])("%s", (raw, expected) => {
    expect(cleanComment(raw)).toBe(expected);
  });

  // Once kept, a file name must not complete a command the shape did not know.
  it.each([
    `${RISK} Lance go run main.go maintenant.`,
    `${RISK} Lance rm cert.pem maintenant.`,
    `${RISK} Lance rm .env maintenant.`,
    `${RISK} Lance mv server.key backup.bak maintenant.`,
    `${RISK} Lance cp server.key backup.bak maintenant.`,
    `${RISK} Lance chmod a+r server.key maintenant.`,
    `${RISK} Lance chown nobody server.key maintenant.`,
    `${RISK} Lance open index.html maintenant.`,
    `${RISK} Lance sqlite3 base.db maintenant.`,
    `${RISK} Lance git apply fix.patch maintenant.`,
    `${RISK} Lance swift main.swift maintenant.`,
    `${RISK} Lance lua init.lua maintenant.`,
    // The broad shape: even to explain, the sentence goes.
    `Un rm cert.pem effacerait la clé. ${RISK}`,
  ])("a program before a file is a command: %s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });
});

describe("a capital letter opening a line is prose, judged as a sentence", () => {
  it.each([
    "Tailscale n'est pas à jour : 1.90.1 installé.",
    "Npm installe aussi les dépendances transitives.",
    "Brew garde d'anciennes versions sur ce Mac.",
    "Curl est ancien sur ce Mac.",
  ])("%s", (line) => {
    expect(cleanComment(`${RISK}\n${line}`)).toBe(`${RISK} ${line}`);
  });

  // As typed in a terminal: a prompt, or the program in small letters.
  it.each([
    "tailscale up",
    "npm publish",
    "brew services start postgresql",
    "curl srv-test-01",
    "softwareupdate --install --all",
    "sudo -v",
    "$ csrutil disable",
    "# csrutil disable",
    "> csrutil disable",
  ])("a command line still goes: %s", (line) => {
    expect(cleanComment(`${RISK}\n${line}\nFin.`)).toBe(`${RISK} Fin.`);
  });

  // This Mac ignores the case of a file name: `Npm` runs npm. Its aliases are npm too.
  it.each([
    "Sudo reboot.",
    "Npm install left-pad-test.",
    "Tailscale up.",
    "Npm x left-pad-test.",
    "Npm in left-pad-test.",
    "Npm isntall left-pad-test.",
    "NPM PUBLISH.",
  ])("with a capital letter, a command goes with its sentence: %s", (line) => {
    expect(cleanComment(`${RISK}\n${line}\nFin.`)).toBe(`${RISK} Fin.`);
  });

  it.each([
    `${RISK} Lance npm x left-pad-test maintenant.`,
    `${RISK} Lance npm publish maintenant.`,
  ])("in a sentence too: %s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });
});

describe("a long run of options is judged quickly", () => {
  it("npm before many options and words", () => {
    const started = performance.now();
    cleanComment(`Le npm${" -1/npm".repeat(15_000)} ?`);
    cleanComment(`Le npm${" -1'/npm".repeat(15_000)} ?`);
    cleanComment(`Le npm${" -1.npm".repeat(15_000)} ?`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
