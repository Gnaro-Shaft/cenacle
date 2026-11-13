// The buttons of an action on a server, through the bot (J6f1b): 🔁 makes a
// request only with the finding's token, only under a server finding of that
// kind, only when the switch is on, once per finding; ✅ Confirmer works
// within its 2 minutes, once, with its own token; anyone but me is ignored;
// the bot never runs anything — the operator does. The buttons appear only
// where they belong.
import { keyboard, parseOpPressed, parsePressed } from "@cenacle/securite";
import { describe, expect, it } from "vitest";
import { handleCallback, listFindings } from "./securite-bot.ts";
import { finding, NOW, OP, OWNER, SIG, TOKEN, tap, world } from "./test-serveur-bot-world.ts";

describe("🔁 under a server finding", () => {
  it("a request for that machine, then my confirmation asked, with its own button", async () => {
    const w = world();
    await handleCallback(tap(`s:41:v:${TOKEN}`), w.deps);
    expect(w.requests).toEqual([{ findingId: 41, host: "v10-essai", at: NOW }]);
    expect(w.calls).toEqual([
      'journal {"action":"server_request"}',
      `buttons 🔁 Relancer les services sur v10-essai (constat n°41) ? Seuls ceux que needrestart désigne, hors exclusions du serveur. o:7:${OP}`,
      "answer 🔁 Constat n°41 : confirme dans les 2 minutes.",
    ]);
  });

  it.each([
    ["the switch off", { active: false }, `s:41:v:${TOKEN}`, /coupées/],
    ["a forged token", {}, `s:41:v:${"f".repeat(16)}`, /plus valable/],
    [
      "a finding of another kind",
      { findings: [finding(41, "serveur_redemarrage")] },
      `s:41:v:${TOKEN}`,
      /n'appelle pas cette action/,
    ],
    ["a finding no longer open", { findings: [] }, `s:41:v:${TOKEN}`, /n'appelle pas cette action/],
    ["a request already waiting", { pending: true }, `s:41:v:${TOKEN}`, /attend déjà/],
  ] as const)("%s: no confirmation asked", async (_label, opts, data, said) => {
    const w = world(opts);
    await handleCallback(tap(data), w.deps);
    expect(w.calls.some((c) => c.startsWith("buttons"))).toBe(false);
    expect(w.calls.at(-1)).toMatch(said);
  });

  it("from anyone but me: ignored, nothing requested", async () => {
    const w = world();
    await handleCallback(tap(`s:41:v:${TOKEN}`, 999), w.deps);
    expect(w.requests).toEqual([]);
    expect(w.calls.some((c) => c.startsWith("answer"))).toBe(false);
  });
});

describe("✅ Confirmer", () => {
  it("within 2 minutes: confirmed, journaled, the button gone; again: already", async () => {
    const w = world();
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.calls).toEqual([
      'journal {"action":"server_confirm"}',
      "answer ✅ Confirmé : l'opérateur s'en charge dans la minute (si le Mac est allumé), et te dira le résultat.",
      "edit 0",
    ]);
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.calls.at(-1)).toMatch(/déjà confirmée/);
  });

  it("my confirmation reaches the store with the bot's signer, and is signed there", async () => {
    const w = world();
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.signatures).toEqual([SIG]);
  });

  it("without the bot's key: nothing reaches the store, nothing is journaled, and it is said", async () => {
    const w = world({ noKey: true });
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.signatures).toEqual([]);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toMatch(
      /^answer 🛑 Je n'ai pas ma clé de confirmation .* rien n'est confirmé/,
    );
  });

  it("a row that cannot be signed: nothing confirmed, nothing journaled, said — and the next tap is not 'already'", async () => {
    const w = world({ unsignable: true });
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.signatures).toEqual([]);
    expect(w.calls).toEqual([
      "answer 🛑 Cette demande ne peut pas être signée : rien n'est confirmé.",
    ]);
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.calls.at(-1)).not.toMatch(/déjà confirmée/);
  });

  it("too late: nothing will be done, said, the button gone", async () => {
    const w = world();
    w.late();
    await handleCallback(tap(`o:7:${OP}`), w.deps);
    expect(w.calls).toEqual([
      "answer ⌛ Délai de 2 minutes dépassé : rien ne sera fait. Rappuie sur 🔁 pour recommencer.",
      "edit 0",
    ]);
  });

  it("another request's token, a forged one, or anyone but me: nothing", async () => {
    for (const data of [`o:8:${OP}`, `o:7:${TOKEN}`, "o:7:not-a-token", `o:7:${OP}:x`]) {
      const w = world();
      await handleCallback(tap(data), w.deps);
      expect(w.calls.some((c) => c.startsWith("journal"))).toBe(false);
    }
    const w = world();
    await handleCallback(tap(`o:7:${OP}`, 999), w.deps);
    expect(w.calls.some((c) => c.includes("Confirmé"))).toBe(false);
  });
});

describe("where the button appears", () => {
  it("/constats: 🔁 under a server finding of that kind, switch on; never elsewhere", async () => {
    const findings = [
      finding(41, "serveur_services"),
      finding(42, "serveur_redemarrage"),
      finding(43, "npm_advisory"),
    ];
    for (const [active, expected] of [
      [true, [41]],
      [false, []],
    ] as const) {
      const w = world({ active, findings });
      await listFindings(OWNER, w.deps);
      const data =
        (w.calls.find((c) => c.startsWith("buttons")) ?? "").split(" ").at(-1)?.split(",") ?? [];
      expect(
        data
          .map(parsePressed)
          .filter((p) => p?.action === "server")
          .map((p) => p?.id),
      ).toEqual(expected);
    }
  });

  it("/constats 61: that finding alone, with its buttons, whatever its rank; unknown: said", async () => {
    const many = Array.from({ length: 12 }, (_, i) => finding(i + 1, "npm_advisory"));
    const w = world({ findings: [...many, finding(61, "serveur_services")] });
    await listFindings(OWNER, w.deps, 61);
    const sent = w.calls.find((c) => c.startsWith("buttons")) ?? "";
    expect(sent).toMatch(/n°61 · moyen/);
    expect(sent).not.toMatch(/n°1 · /);
    expect(
      sent
        .split(" ")
        .at(-1)
        ?.split(",")
        .map(parsePressed)
        .map((p) => p?.action),
    ).toEqual(["take", "keep", "refuse", "server"]);
    const none = world({ findings: many });
    await listFindings(OWNER, none.deps, 61);
    expect(none.calls).toEqual(["send 🛡 Aucun constat ouvert n°61."]);
  });

  it("the data stays within Telegram's 64 bytes, and reads back exactly", () => {
    const [row] = keyboard([{ id: 999_999_999_999, token: TOKEN, server: "redemarrer" }]);
    for (const b of row ?? []) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
    expect(parsePressed(`s:41:v:${TOKEN}`)).toEqual({ id: 41, action: "server", token: TOKEN });
    expect(parseOpPressed(`o:7:${OP}`)).toEqual({ id: 7, token: OP });
    expect(parseOpPressed(`o:0:${OP}`)).toBeNull();
    expect(parseOpPressed(`xo:7:${OP}`)).toBeNull();
    expect(parseOpPressed(`s:7:${OP}`)).toBeNull();
  });
});

describe("🔄 under a reboot finding (J6f2)", () => {
  it("a reboot request for that machine, said as a reboot", async () => {
    const w = world({ findings: [finding(44, "serveur_redemarrage")] });
    await handleCallback(tap(`s:44:b:${TOKEN}`), w.deps);
    expect(w.requests).toEqual([{ findingId: 44, host: "v10-essai", at: NOW }]);
    expect(w.calls.find((c) => c.startsWith("buttons"))).toMatch(
      /^buttons 🔄 Redémarrer v10-essai \(constat n°44\) \? Dans une minute/,
    );
  });

  it("the reboot button under a services finding, or the services one under a reboot finding: refused", async () => {
    const services = world({ findings: [finding(41, "serveur_services")] });
    await handleCallback(tap(`s:41:b:${TOKEN}`), services.deps);
    expect(services.requests).toEqual([]);
    const reboot = world({ findings: [finding(44, "serveur_redemarrage")] });
    await handleCallback(tap(`s:44:v:${TOKEN}`), reboot.deps);
    expect(reboot.requests).toEqual([]);
    expect(reboot.calls.at(-1)).toMatch(/n'appelle pas cette action/);
  });

  it("/constats: 🔄 under a reboot finding, 🔁 under a services one, nothing elsewhere", async () => {
    const w = world({
      findings: [
        finding(41, "serveur_services"),
        finding(44, "serveur_redemarrage"),
        finding(45, "serveur_disque"),
      ],
    });
    await listFindings(OWNER, w.deps);
    const data =
      (w.calls.find((c) => c.startsWith("buttons")) ?? "").split(" ").at(-1)?.split(",") ?? [];
    const actions = data
      .map(parsePressed)
      .filter((p) => p?.action === "server" || p?.action === "reboot");
    expect(actions.map((p) => [p?.id, p?.action])).toEqual([
      [41, "server"],
      [44, "reboot"],
    ]);
  });
});

describe("⬆ under a security-update finding (J6f3)", () => {
  it("an update request for that machine, said without reboot", async () => {
    const w = world({ findings: [finding(46, "serveur_maj_securite")] });
    await handleCallback(tap(`s:46:u:${TOKEN}`), w.deps);
    expect(w.requests).toEqual([{ findingId: 46, host: "v10-essai", at: NOW }]);
    expect(w.calls.find((c) => c.startsWith("buttons"))).toMatch(
      /^buttons ⬆ Appliquer les mises à jour de sécurité sur v10-essai \(constat n°46\) \? Sans redémarrage/,
    );
  });

  it("⬆ under a reboot finding, or 🔄 under an update finding: refused", async () => {
    const r = world({ findings: [finding(44, "serveur_redemarrage")] });
    await handleCallback(tap(`s:44:u:${TOKEN}`), r.deps);
    expect(r.requests).toEqual([]);
    const u = world({ findings: [finding(46, "serveur_maj_securite")] });
    await handleCallback(tap(`s:46:b:${TOKEN}`), u.deps);
    expect(u.requests).toEqual([]);
  });

  it("/constats: ⬆ under the update finding only", async () => {
    const w = world({
      findings: [finding(46, "serveur_maj_securite"), finding(47, "serveur_port")],
    });
    await listFindings(OWNER, w.deps);
    const data =
      (w.calls.find((c) => c.startsWith("buttons")) ?? "").split(" ").at(-1)?.split(",") ?? [];
    expect(
      data
        .map(parsePressed)
        .filter((p) => p?.action === "update")
        .map((p) => p?.id),
    ).toEqual([46]);
  });
});
