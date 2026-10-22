// The CTO's word (J6a), since 2026-10-21: chown, chgrp and chflags before an
// account, a group or a flag this Mac knows are commands, as this Mac's tools
// take them; before another name, they are prose.
import { describe, expect, it } from "vitest";
import { cleanComment } from "./comment.ts";

const RISK = "Le risque est réel.";

describe("chown, chgrp and chflags before what this Mac takes are commands", () => {
  // chown: a number, signed or with leading zeros; an account of this Mac, alone or before a
  // colon; any owner and group on each side of a colon, or the group alone; a variable.
  it.each([
    "chown root secret",
    "chown 0 secret",
    "chown +0 secret",
    "chown 0501 secret",
    "chown nobody secret",
    "chown daemon secret",
    "chown _www secret",
    "chown root:wheel secret",
    "chown 0:0 secret",
    "chown 501:+20 secret",
    "chown :wheel secret",
    "chown root: secret",
    "chown alice:staff secret",
    "chown jean.dupont:staff secret",
    "chown jean-luc:staff secret",
    "chown $USER secret",
    // In capitals, between quotes, in Markdown, in wide letters, with an invisible character, alone.
    "chown ROOT secret",
    "Chown root secret",
    'chown "root" secret',
    "chown **root** secret",
    "chown ｒｏｏｔ secret",
    "chown ro⁠ot secret",
    "chown root",
    "chown root:wheel",
  ])("%s", (command) => {
    expect(cleanComment(`${RISK} Lance ${command} maintenant.`)).toBe(RISK);
  });

  // chgrp: a number, a group of this Mac, a service group, a variable.
  it.each([
    "chgrp staff secret",
    "chgrp wheel secret",
    "chgrp admin secret",
    "chgrp everyone secret",
    "chgrp nogroup secret",
    "chgrp operator secret",
    "chgrp _developer secret",
    "chgrp 0 secret",
    "chgrp 20 secret",
    "chgrp +20 secret",
    "chgrp 0020 secret",
    "chgrp $GROUP secret",
    "Chgrp STAFF secret",
    // `--` ends the options: what follows is the group.
    "chgrp -- staff secret",
    "chgrp staff",
  ])("%s", (command) => {
    expect(cleanComment(`${RISK} Lance ${command} maintenant.`)).toBe(RISK);
  });

  // chflags: a flag, with or without `no`, the ones its manual leaves out too; a list, even
  // with empty items; octal.
  it.each([
    "chflags hidden secret",
    "chflags nohidden secret",
    "chflags uchg secret",
    "chflags nouchg secret",
    "chflags noschg secret",
    "chflags uappnd secret",
    "chflags nouappend secret",
    "chflags uimmutable secret",
    "chflags nodump secret",
    "chflags dump secret",
    "chflags opaque secret",
    "chflags archived secret",
    "chflags norestricted secret",
    "chflags nosunlnk secret",
    "chflags hidden,uchg secret",
    "chflags ,hidden secret",
    "chflags hidden,,uchg secret",
    // Spaces after a comma, between quotes; a variable left empty; `--`; flags of the C library.
    'chflags ", hidden" secret',
    "chflags $X hidden secret",
    "chflags -- hidden secret",
    "chflags sunlink secret",
    "chflags nodataless secret",
    "chflags 0 secret",
    "chflags 100000 secret",
    "chflags hid­den secret",
    "chflags ｈｉｄｄｅｎ secret",
    "chflags hidden",
  ])("%s", (command) => {
    expect(cleanComment(`${RISK} Lance ${command} maintenant.`)).toBe(RISK);
  });

  it.each([
    `${RISK} Lance chown root.`,
    `${RISK} Lance chgrp staff.`,
    `${RISK} Lance chflags hidden.`,
    `${RISK} Lance chown root:wheel, puis relance.`,
    `${RISK}\nchown root secret\nFin.`,
    `${RISK}\nchflags nouchg secret\nFin.`,
  ])("at the end of a clause or on its own line: %s", (raw) => {
    expect(cleanComment(raw)).toBe(RISK);
  });

  // The broad shape: even to explain, the sentence goes.
  it.each([
    "Un chown root sur secret le donnerait à root.",
    "Le chown root:wheel du fichier est le bon.",
    "Le chgrp staff ne suffit pas.",
    "Un chflags hidden ne protège rien.",
  ])("written as a command, the sentence goes: %s", (sentence) => {
    expect(cleanComment(`${sentence} ${RISK}`)).toBe(RISK);
  });
});

describe("before another name, chown, chgrp and chflags are prose", () => {
  it.each([
    "Le chown de root a été appliqué hier.",
    "Un chgrp trop large expose la clé.",
    "Entre chown ou chmod, le second suffit.",
    "Le chown ou le chmod suffit.",
    "Un chown change le propriétaire du fichier.",
    "Le chgrp a échoué sur ce fichier.",
    "Le chgrp a-t-il été appliqué ?",
    "Après un chown, le fichier appartient à root.",
    "Le fichier appartient à root:wheel.",
    "Le chflags de macOS cache les fichiers.",
    "Un chflags mal placé bloque la mise à jour.",
    "Les outils chown, chgrp et chflags règlent les droits.",
    "Les outils chown + chgrp règlent les droits.",
    // A colon between spaces is punctuation, as a lone sign is; glued to a word, a colon with
    // no group after it too (a model often writes it so).
    "Le chown : l'outil du propriétaire.",
    "Le problème vient du chown récursif: tout le dossier appartient désormais à root.",
    "Le journal indique chown failed: Operation not permitted.",
    // A version is no number; a word that starts as an account or a flag is neither.
    "Le binaire chown 8.32 est ancien.",
    "Le chflags 2.0 est ancien.",
    "Un chown rootless n'existe pas.",
    "Un chgrp administrateur n'existe pas.",
    "Un chflags hiddenfile n'existe pas.",
    // Markdown emphasis is no service account.
    "Le chown _récursif_ touche aussi les liens symboliques.",
  ])("%s", (sentence) => {
    expect(cleanComment(sentence)).toBe(sentence);
  });
});

describe("a long run after chown, chgrp or chflags is judged quickly", () => {
  it("names, colons, digits and commas", () => {
    const started = performance.now();
    cleanComment(`Le chown ${"a".repeat(40_000)}z ?`);
    cleanComment(`Le chown ${"a:".repeat(20_000)}z ?`);
    cleanComment(`Le chown ${"7".repeat(40_000)}.5 ?`);
    cleanComment(`Le chflags ${",".repeat(40_000)}z ?`);
    // Each `¨` becomes a space once normalised.
    cleanComment(`Le chflags ${"¨".repeat(40_000)}z ?`);
    cleanComment(`Le chgrp _${"a".repeat(40_000)}- ?`);
    cleanComment(`Le${" chown chgrp chflags".repeat(3_000)} ?`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
