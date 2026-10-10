// What a mailbox may do beyond reading (M2, M3 — ADR-0015). A real box is
// read-only until I open it, in two dated steps; anything else stops Cénacle.
// Each writer checks the opening again itself, before any connection.
import { describe, expect, it } from "vitest";
import { parseCadre, ReadOnlyMailboxError, refuseDrafts, refuseSending } from "./cadre.ts";
import { senderAuthFor, storedVerdict, type VerdictMemory } from "./draft-auth.ts";
import { copyToSent, sendReply } from "./sender.ts";

const TODAY = "2026-10-20";
const CONSERVATION =
  "[conservation]\nmemoire_jours = 90\ntexte_brouillon_jours = 7\npropositions_jours = 90\njournal_jours = 180\nopposition_jours = 1095\n";
const mail = (host: string, address: string, extra = "") =>
  `[mail]\n${extra}source = "boite-pro"\nhost = "${host}"\nport = 993\nuser = "moi"\n` +
  `mailbox = "INBOX"\nsent_mailbox = "Sent"\nmax_per_fetch = 500\nsmtp_port = 465\naddress = "${address}"\n` +
  `authserv_id = "mx.box.test"\nrang_attendu = 5\n`;
const T01 =
  `[[traitement]]\nidentifiant = "T-01"\nfinalite = "Ranger la boîte pro."\n` +
  `base_legale = "interet-legitime"\ncategories = ["UID", "clés HMAC"]\n` +
  `sources = ["boite-pro"]\ntiers = true\nmention_publiee = 2026-10-04\n`;
const ENVOI = '[envoi]\ndestinataires = ["moi@entreprise.example"]\n';
const real = (extra = "", tail = "") =>
  parseCadre(
    mail("ssl0.mail.example", "moi@entreprise.example", extra) + CONSERVATION + T01 + ENVOI + tail,
    TODAY,
  );
const open = (o: string) => real("", `[ouverture]\n${o}`);

describe("a real box is read-only until opened (M2)", () => {
  it("no [ouverture]: no draft, no sending, authentication asked", () => {
    const m = real().mail;
    expect([m.drafts, m.sending, m.authRequired]).toEqual([false, "none", true]);
  });

  it("test = false written out changes nothing", () => {
    expect(real("test = false\n").mail.sending).toBe("none");
  });

  it("a real test box keeps drafts and its closed list, without authentication (M1)", () => {
    const m = real("test = true\n").mail;
    expect([m.drafts, m.sending, m.authRequired, m.undoMs, m.maxPerDay]).toEqual([
      true,
      "closed",
      false,
      2 * 60_000,
      20,
    ]);
  });

  it("the fictional box sends to test domains only", () => {
    const m = parseCadre(mail("127.0.0.1", "test-cenacle@cenacle.test") + CONSERVATION, TODAY).mail;
    expect([m.drafts, m.sending, m.recipients]).toEqual([true, "test-domains", null]);
  });

  it.each([
    ["a string", 'test = "true"\n'],
    ["a number", "test = 1\n"],
  ])("a test mark written as %s is refused, not taken as true", (_label, extra) => {
    expect(() => real(extra)).toThrow(/mail\.test must be true or false/);
  });

  it("no [mail] key can open it", () => {
    expect(() => real("read_only = false\n")).toThrow(/unknown key "read_only"/);
    expect(() => real("brouillons = true\n")).toThrow(/unknown key "brouillons"/);
  });
});

describe("opening a real box, in two dated steps (M3)", () => {
  it("brouillons: drafts, sends still to my closed list only", () => {
    const m = open("brouillons = 2026-10-20\n").mail;
    expect([m.drafts, m.sending, m.draftsSince, m.sendingSince]).toEqual([
      true,
      "closed",
      "2026-10-20",
      null,
    ]);
  });

  it("brouillons then envoi: the real correspondent", () => {
    const m = open("brouillons = 2026-10-18\nenvoi = 2026-10-20\n").mail;
    expect([m.drafts, m.sending, m.sendingSince]).toEqual([true, "correspondents", "2026-10-20"]);
  });

  it("a real box keeps its limits: 5 a day by default, a 10-minute undo, authentication", () => {
    const m = open("brouillons = 2026-10-18\nenvoi = 2026-10-20\n").mail;
    expect([m.maxPerDay, m.undoMs, m.authRequired]).toEqual([5, 10 * 60_000, true]);
  });

  it.each([
    ["envoi without brouillons", "envoi = 2026-10-20\n", /needs ouverture\.brouillons/],
    [
      "envoi before brouillons",
      "brouillons = 2026-10-20\nenvoi = 2026-10-19\n",
      /needs ouverture\.brouillons/,
    ],
    ["a date not reached yet", "brouillons = 2026-10-21\n", /not reached yet/],
    ["a boolean instead of a date", "brouillons = true\n", /date of my decision/],
    ["a malformed date string", 'brouillons = "20/10/2026"\n', /date of my decision/],
    ["an impossible date", 'brouillons = "2026-13-45"\n', /date of my decision/],
    ["an unknown key", "brouillons = 2026-10-18\ntout = true\n", /unknown key "tout"/],
  ])("refuses %s", (_label, o, why) => {
    expect(() => open(o)).toThrow(why);
  });

  it("[ouverture] on a test box or the fictional box is refused (they are open already)", () => {
    expect(() => real("test = true\n", "[ouverture]\nbrouillons = 2026-10-18\n")).toThrow(
      /real mailbox only/,
    );
    expect(() =>
      parseCadre(
        mail("127.0.0.1", "test-cenacle@cenacle.test") +
          CONSERVATION +
          "[ouverture]\nbrouillons = 2026-10-18\n",
        TODAY,
      ),
    ).toThrow(/real mailbox only/);
  });

  const withMax = (v: string) =>
    parseCadre(
      mail("ssl0.mail.example", "moi@entreprise.example") +
        CONSERVATION +
        T01 +
        `[envoi]\ndestinataires = ["moi@entreprise.example"]\nmax_par_jour = ${v}\n`,
      TODAY,
    );

  it.each(["0", "21", "2.5", '"5"', "-1"])("max_par_jour = %s is refused", (v) => {
    expect(() => withMax(v)).toThrow(/max_par_jour must be an integer from 1 to 20/);
  });

  it("max_par_jour on a real test box is refused (its limit is the test one)", () => {
    expect(() =>
      parseCadre(
        mail("ssl0.mail.example", "moi@entreprise.example", "test = true\n") +
          CONSERVATION +
          T01 +
          '[envoi]\ndestinataires = ["moi@entreprise.example"]\nmax_par_jour = 3\n',
        TODAY,
      ),
    ).toThrow(/real mailbox only/);
  });

  it("max_par_jour within bounds is kept", () => {
    const s =
      mail("ssl0.mail.example", "moi@entreprise.example") +
      CONSERVATION +
      T01 +
      '[envoi]\ndestinataires = ["moi@entreprise.example"]\nmax_par_jour = 3\n';
    expect(parseCadre(s, TODAY).mail.maxPerDay).toBe(3);
  });
});

describe("each writer refuses by itself", () => {
  it("refuseDrafts: only an explicit true lets through", () => {
    expect(() => refuseDrafts({ drafts: false }, "x")).toThrow(ReadOnlyMailboxError);
    expect(() => refuseDrafts({} as { drafts: boolean }, "x")).toThrow(ReadOnlyMailboxError);
    expect(() => refuseDrafts({ drafts: true }, "x")).not.toThrow();
  });

  it("refuseSending: no mode, or an unknown one, sends nothing", () => {
    expect(() => refuseSending({ sending: "none" }, "x")).toThrow(ReadOnlyMailboxError);
    expect(() => refuseSending({ sending: "everyone" } as never, "x")).toThrow(
      ReadOnlyMailboxError,
    );
    expect(() => refuseSending({} as never, "x")).toThrow(ReadOnlyMailboxError);
    expect(() => refuseSending({ sending: "closed" }, "x")).not.toThrow();
  });

  it("a read-only box: no SMTP connection is even attempted", async () => {
    const cadre = { ...real().mail, host: "203.0.113.1", smtpPort: 1 };
    const reply = { to: "moi@entreprise.example", raw: Buffer.from("x") };
    await expect(sendReply(cadre, "pw", reply)).rejects.toThrow(ReadOnlyMailboxError);
  });

  it("a read-only box: no copy is written to Sent", async () => {
    const cadre = { ...real().mail, host: "203.0.113.1", port: 1 };
    await expect(copyToSent(cadre, "pw", Buffer.from("x"))).rejects.toThrow(ReadOnlyMailboxError);
  });
});

describe("sender authentication on a real box: ADR-0014's verdict, kept with the mail", () => {
  const memory = (
    validity: string | null,
    mails: { uid: number; senderAuthenticated: boolean }[],
  ): VerdictMemory => ({
    position: async () => (validity === null ? null : { uidValidity: validity }),
    inbox: async () => mails,
  });
  const box = memory("9", [
    { uid: 1, senderAuthenticated: true },
    { uid: 2, senderAuthenticated: false },
  ]);
  const opened = open("brouillons = 2026-10-18\n").mail;

  it("an authenticated sender: yes", async () => {
    expect(await senderAuthFor(opened, storedVerdict(box))(1, "9")).toBe(true);
  });

  it.each([
    ["not authenticated", 2, "9", box],
    ["a mail Iris does not remember", 3, "9", box],
    ["a renumbered box (another UIDVALIDITY)", 1, "8", box],
    ["a box Iris knows nothing of", 1, "9", memory(null, [])],
  ] as const)("%s: no", async (_label, uid, validity, mem) => {
    expect(await senderAuthFor(opened, storedVerdict(mem))(uid, validity)).toBe(false);
  });

  it("a verdict that is not exactly true is no", async () => {
    const odd = memory("9", [{ uid: 1, senderAuthenticated: "true" as never }]);
    expect(await storedVerdict(odd)(1, "9")).toBe(false);
  });

  it("a memory that fails: the check fails, it never says yes", async () => {
    const broken: VerdictMemory = {
      position: async () => ({ uidValidity: "9" }),
      inbox: async () => {
        throw new Error("base down");
      },
    };
    await expect(storedVerdict(broken)(1, "9")).rejects.toThrow("base down");
  });

  it("a test box does not ask, whatever the memory says", async () => {
    const never = memory("9", []);
    expect(await senderAuthFor(real("test = true\n").mail, storedVerdict(never))(1, "9")).toBe(
      true,
    );
  });

  it("a cadre without the field asks (only an explicit false skips it)", async () => {
    expect(await senderAuthFor({} as never, storedVerdict(box))(2, "9")).toBe(false);
  });
});
