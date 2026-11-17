// S1: no program starts with a secret that is not its own, and splitting .env
// moves each secret once, keeps everything else, and never shows a value.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agendaPasswordVar,
  familyOf,
  refuseForeignSecrets,
  SecretPlacementError,
  splitEnv,
} from "./secrets.ts";

const ALL = {
  CENACLE_DB_ADMIN_PASSWORD: "admin-value",
  CENACLE_DB_OWNER_PASSWORD: "owner-secret-value",
  CENACLE_TEST_MAIL_PASSWORD: "mail-secret-value",
  CENACLE_MAIL_KEY: "k".repeat(64),
  TELEGRAM_BOT_TOKEN: "123:telegram-secret",
  GRAFANA_ADMIN_PASSWORD: "grafana-secret",
  CENACLE_ACCEPT_PRIVATE_KEY: "private-key-value",
  CENACLE_DB_EXECUTOR_PASSWORD: "executor-secret",
};

describe("each program holds its own secrets, and only them", () => {
  it.each([
    ["Iris", ["mail", "telegram"]],
    ["the page's server", ["mail", "page"]],
    ["the executor", ["mail", "executor"]],
    ["the Telegram bot", ["telegram"]],
  ] as const)("%s refuses every other family, the database owner first", (program, allowed) => {
    expect(() => refuseForeignSecrets(program, allowed, ALL)).toThrow(SecretPlacementError);
    expect(() => refuseForeignSecrets(program, allowed, ALL)).toThrow(/CENACLE_DB_OWNER_PASSWORD/);
    const own = Object.fromEntries(
      Object.entries(ALL).filter(([name]) =>
        allowed.some((f) =>
          ({
            mail: ["CENACLE_TEST_MAIL_PASSWORD", "CENACLE_MAIL_KEY"],
            telegram: ["TELEGRAM_BOT_TOKEN"],
            page: ["CENACLE_ACCEPT_PRIVATE_KEY"],
            executor: ["CENACLE_DB_EXECUTOR_PASSWORD"],
          })[f].includes(name),
        ),
      ),
    );
    expect(() =>
      refuseForeignSecrets(program, allowed, { ...own, CENACLE_DB_PORT: "1" }),
    ).not.toThrow();
  });

  it("names the variables, never their values; an empty value is not a secret held", () => {
    try {
      refuseForeignSecrets("Iris", ["mail"], { TELEGRAM_BOT_TOKEN: "123:telegram-secret" });
    } catch (error) {
      expect(String(error)).toContain("TELEGRAM_BOT_TOKEN");
      expect(String(error)).not.toContain("telegram-secret");
    }
    expect(() => refuseForeignSecrets("Iris", [], { TELEGRAM_BOT_TOKEN: "" })).not.toThrow();
  });
});

describe("splitting .env", () => {
  const env = [
    "# Copy to .env",
    "CENACLE_DB_PORT=55432",
    "CENACLE_DB_OWNER_PASSWORD=owner-secret-value",
    "",
    "export TELEGRAM_BOT_TOKEN=123:telegram-secret",
    "TELEGRAM_ALLOWED_CHAT_ID=42",
    "CENACLE_MAIL_KEY=" + "k".repeat(64),
    "CENACLE_TEST_MAIL_PASSWORD = spaced",
    "GRAFANA_ADMIN_PASSWORD=grafana-secret",
  ].join("\n");

  it("moves each secret to its family, keeps the rest in order", () => {
    const plan = splitEnv(env);
    expect(plan.remaining).toEqual([
      "# Copy to .env",
      "CENACLE_DB_PORT=55432",
      "",
      "TELEGRAM_ALLOWED_CHAT_ID=42",
    ]);
    expect(plan.moved.owner).toEqual(["CENACLE_DB_OWNER_PASSWORD=owner-secret-value"]);
    expect(plan.moved.telegram).toEqual(["export TELEGRAM_BOT_TOKEN=123:telegram-secret"]);
    expect(plan.moved.mail).toHaveLength(2);
    expect(plan.moved.obs).toEqual(["GRAFANA_ADMIN_PASSWORD=grafana-secret"]);
  });

  it("the summary shows names only, never a value", () => {
    const summary = JSON.stringify(splitEnv(env).summary);
    expect(summary).toContain("CENACLE_DB_OWNER_PASSWORD");
    for (const value of ["owner-secret-value", "telegram-secret", "grafana-secret", "spaced"]) {
      expect(summary).not.toContain(value);
    }
  });

  it("refuses a secret defined twice: which one would win is not for the script to guess", () => {
    expect(() => splitEnv("CENACLE_MAIL_KEY=a\nCENACLE_MAIL_KEY=b")).toThrow(/defined twice/);
  });

  it("a .env without secrets moves nothing", () => {
    expect(splitEnv("CENACLE_DB_PORT=1\n").moved).toEqual({});
  });
});

describe("the database's superuser is held by no program (ADR-0038)", () => {
  it("a program that finds the admin password refuses to start, naming it only", () => {
    const env = { CENACLE_DB_ADMIN_PASSWORD: "admin-value" };
    expect(() => refuseForeignSecrets("the CTO", [], env)).toThrow(/CENACLE_DB_ADMIN_PASSWORD/);
    expect(() => refuseForeignSecrets("the CTO", [], env)).not.toThrow(/admin-value/);
  });

  it("no program in the tree lists the admin family among its own", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const calls: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of readdirSync(join(root, top), { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts") || file.includes("node_modules") || file.includes(".test.")) {
          continue;
        }
        const text = readFileSync(join(root, top, file), "utf8");
        for (const m of text.matchAll(/refuseForeignSecrets\(\s*[^,]+,\s*\[([^\]]*)\]/g)) {
          calls.push(`${top}/${file}: ${m[1] ?? ""}`);
        }
      }
    }
    expect(calls.length).toBeGreaterThan(10); // the scan really found the programs
    expect(calls.filter((c) => /["']admin["']/.test(c))).toEqual([]);
  });
});

describe("the agenda's passwords, a family known by its prefix (ADR-0042)", () => {
  const env = { CENACLE_AGENDA_MOT_DE_PASSE_PERSO: "app-password-value" };

  it("any account's password belongs to the family, whatever its name", () => {
    expect(familyOf("CENACLE_AGENDA_MOT_DE_PASSE_PRO")).toBe("agenda");
    expect(familyOf("CENACLE_AGENDA_MOT_DE_PASSE_UN_NOM_INVENTE")).toBe("agenda");
    expect(familyOf(agendaPasswordVar("perso"))).toBe("agenda");
    // The bare prefix is refused too: a typo is never a free pass.
    expect(familyOf("CENACLE_AGENDA_MOT_DE_PASSE_")).toBe("agenda");
    expect(familyOf("CENACLE_AGENDA_FENETRE")).toBeNull();
    expect(familyOf("XCENACLE_AGENDA_MOT_DE_PASSE_PRO")).toBeNull();
  });

  it.each([
    ["Iris", ["mail", "telegram"]],
    ["the Telegram bot", ["telegram", "bot", "sentinel"]],
    ["the CTO", []],
    ["the executor", ["mail", "executor", "sentinel"]],
  ] as const)("%s refuses to start with it, naming it, never its value", (program, allowed) => {
    expect(() => refuseForeignSecrets(program, allowed, env)).toThrow(
      /CENACLE_AGENDA_MOT_DE_PASSE_PERSO/,
    );
    expect(() => refuseForeignSecrets(program, allowed, env)).not.toThrow(/app-password-value/);
  });

  it("the page's server holds it; an empty value is not held", () => {
    expect(() =>
      refuseForeignSecrets("the page's server", ["mail", "page", "proxmox", "agenda"], env),
    ).not.toThrow();
    expect(() =>
      refuseForeignSecrets("Iris", [], { CENACLE_AGENDA_MOT_DE_PASSE_PRO: "" }),
    ).not.toThrow();
  });

  it("splitting .env moves it to .env.agenda", () => {
    const plan = splitEnv("CENACLE_DB_PORT=1\nCENACLE_AGENDA_MOT_DE_PASSE_PRO=x\n");
    expect(plan.moved.agenda).toEqual(["CENACLE_AGENDA_MOT_DE_PASSE_PRO=x"]);
    expect(plan.summary[".env.agenda"]).toEqual(["CENACLE_AGENDA_MOT_DE_PASSE_PRO"]);
    expect(plan.remaining).toEqual(["CENACLE_DB_PORT=1", ""]);
  });

  it("only the page's server lists the family among its own", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const holders: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of readdirSync(join(root, top), { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts") || file.includes("node_modules") || file.includes(".test.")) {
          continue;
        }
        const text = readFileSync(join(root, top, file), "utf8");
        for (const m of text.matchAll(/refuseForeignSecrets\(\s*[^,]+,\s*\[([^\]]*)\]/g)) {
          if (/["']agenda["']/.test(m[1] ?? "")) holders.push(`${top}/${file}`);
        }
      }
    }
    expect(holders).toEqual(["apps/server/src/main.ts"]);
  });
});
