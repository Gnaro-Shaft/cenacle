// Before merging, the security agent verifies that I asked (ADR-0036, second
// step): a "fusion_demandee" written without the bot, a signature copied to
// another finding, pull request or commit, signed by another key, older than
// 30 minutes or from the future, or naming a pull request of another
// repository is refused by name. Without the bot's public key, nothing
// merges; the agent never holds the private one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  confirmPrivateKeyFromEnv,
  generateConfirmationKeys,
  type MergeConfirmation,
  refuseForeignSecrets,
  type SecretFamily,
  signMergeConfirmation,
} from "@cenacle/core";
import { describe, expect, it } from "vitest";
import {
  inRepository,
  MERGE_CONFIRM_MAX_MS,
  mergeKeyOrNull,
  mergeNotSigned,
  ownRepository,
} from "./merge-signed.ts";

const keys = generateConfirmationKeys();
const priv = confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey });
const publicKey = mergeKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: keys.publicKey });
const other = generateConfirmationKeys();
const otherPriv = confirmPrivateKeyFromEnv({ [CONFIRM_PRIVATE_KEY_VAR]: other.privateKey });

const SHA = "c".repeat(40);
const URL = "https://github.com/exemple/cenacle/pull/12";
const AT = new Date("2026-11-15T10:00:00.000Z");
const REPO = "exemple/cenacle";

const row = (over: Partial<MergeConfirmation> & { sig?: string | null } = {}) => {
  const fields: MergeConfirmation = {
    findingId: 7,
    prUrl: URL,
    headSha: SHA,
    confirmedAt: AT,
    ...over,
  };
  return {
    id: fields.findingId,
    actionPrUrl: fields.prUrl,
    actionHeadSha: fields.headSha,
    mergeConfirmedAt: fields.confirmedAt,
    mergeSig: over.sig === undefined ? signMergeConfirmation(priv, fields) : over.sig,
  };
};
const at = (ms: number) => ({ publicKey, repository: REPO, now: new Date(AT.getTime() + ms) });

describe("a merge request the bot signed", () => {
  it("my own tap: verified", () => {
    expect(mergeNotSigned(row(), at(60_000))).toBeNull();
  });

  it("written without the bot, or with a garbage signature: refused", () => {
    expect(mergeNotSigned(row({ sig: null }), at(0))).toBe("non_signee");
    expect(mergeNotSigned(row({ sig: "A".repeat(86) }), at(0))).toBe("non_signee");
    expect(mergeNotSigned(row({ sig: "" }), at(0))).toBe("non_signee");
  });

  it("my signature copied onto another finding, pull request or commit: refused", () => {
    const mine = row().mergeSig;
    const moved = [
      { ...row(), id: 8 },
      { ...row(), actionPrUrl: "https://github.com/exemple/cenacle/pull/13" },
      { ...row(), actionHeadSha: "d".repeat(40) },
      { ...row(), mergeConfirmedAt: new Date(AT.getTime() + 1) },
    ];
    for (const r of moved)
      expect(mergeNotSigned({ ...r, mergeSig: mine }, at(0))).toBe("non_signee");
  });

  it("a row with a field missing: refused, never trusted", () => {
    expect(mergeNotSigned({ ...row(), actionPrUrl: null }, at(0))).toBe("non_signee");
    expect(mergeNotSigned({ ...row(), actionHeadSha: null }, at(0))).toBe("non_signee");
    expect(mergeNotSigned({ ...row(), mergeConfirmedAt: null }, at(0))).toBe("non_signee");
  });

  it("signed by another key: refused", () => {
    const forged = signMergeConfirmation(otherPriv, {
      findingId: 7,
      prUrl: URL,
      headSha: SHA,
      confirmedAt: AT,
    });
    expect(mergeNotSigned(row({ sig: forged }), at(0))).toBe("non_signee");
  });

  it("30 minutes hold; a millisecond more, or a confirmation from the future, does not", () => {
    expect(mergeNotSigned(row(), at(MERGE_CONFIRM_MAX_MS))).toBeNull();
    expect(mergeNotSigned(row(), at(MERGE_CONFIRM_MAX_MS + 1))).toBe("trop_ancienne");
    expect(mergeNotSigned(row(), at(-60_000))).toBeNull();
    expect(mergeNotSigned(row(), at(-60_001))).toBe("trop_ancienne");
  });

  it("a pull request of another repository, even signed: refused", () => {
    const elsewhere = row({ prUrl: "https://github.com/exemple/autre/pull/12" });
    expect(mergeNotSigned(elsewhere, at(0))).toBe("autre_depot");
    expect(mergeNotSigned(row(), { ...at(0), repository: null })).toBe("autre_depot");
    expect(
      mergeNotSigned(row({ prUrl: "https://github.com/Exemple/Cenacle/pull/12" }), at(0)),
    ).toBeNull();
  });

  it("without the bot's public key nothing is verified, so nothing merges", () => {
    expect(mergeNotSigned(row(), { ...at(0), publicKey: null })).toBe("cle_absente");
    expect(mergeKeyOrNull({})).toBeNull();
    expect(mergeKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: "not-a-key" })).toBeNull();
    expect(mergeKeyOrNull({ [CONFIRM_PUBLIC_KEY_VAR]: keys.privateKey })).toBeNull();
  });
});

describe("the bot refuses to sign what it cannot pin down", () => {
  it("an address that is not a pull request, a short commit, a bad finding", () => {
    for (const bad of [
      { prUrl: "https://github.com/exemple/cenacle/pull/12?x=1" },
      { prUrl: "https://github.com/exemple/cenacle/pull/12/files" },
      { prUrl: "https://gitlab.com/exemple/cenacle/pull/12" },
      { prUrl: "http://github.com/exemple/cenacle/pull/12" },
      { prUrl: "https://github.com/exemple/../pull/12" },
      { prUrl: "https://github.com/exemple/cenacle/pull/12\nhttps://github.com/x/y/pull/1" },
      { headSha: SHA.slice(0, 12) },
      { headSha: "C".repeat(40) },
      { findingId: 0 },
      { confirmedAt: new Date(Number.NaN) },
    ]) {
      expect(() =>
        signMergeConfirmation(priv, {
          findingId: 7,
          prUrl: URL,
          headSha: SHA,
          confirmedAt: AT,
          ...bad,
        }),
      ).toThrow();
    }
  });
});

describe("the project's own repository", () => {
  const ops = (code: number, stdout: string) => ({
    run: async () => ({ code, stdout, stderr: "" }),
    root: "/nowhere",
    gh: "/nowhere/gh",
  });

  it("read from gh, lower case; anything odd reads as unknown", async () => {
    expect(await ownRepository(ops(0, "Exemple/Cenacle\n"))).toBe("exemple/cenacle");
    expect(await ownRepository(ops(1, "exemple/cenacle\n"))).toBeNull();
    expect(await ownRepository(ops(0, ""))).toBeNull();
    expect(await ownRepository(ops(0, "exemple/cenacle\nautre/depot"))).toBeNull();
    expect(await ownRepository(ops(0, "exemple"))).toBeNull();
  });
});

describe("a pull request to close (❌ Fermer)", () => {
  it("only of the project's own repository, never when it is unknown", () => {
    expect(inRepository(URL, REPO)).toBe(true);
    expect(inRepository("https://github.com/Exemple/Cenacle/pull/3", REPO)).toBe(true);
    for (const url of [
      "https://github.com/exemple/autre/pull/3",
      "https://github.com/autre/cenacle/pull/3",
      "https://github.com/exemple/cenacle-bis/pull/3",
      "https://github.com/exemple/cenacle/pull/3/files",
      "",
    ]) {
      expect(inRepository(url, REPO)).toBe(false);
    }
    expect(inRepository(URL, null)).toBe(false);
  });
});

describe("the keys", () => {
  it("the security agent refuses to start with the bot's private key", () => {
    const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");
    const m = /refuseForeignSecrets\("L'agent sécurité", \[([^\]]*)\]\)/.exec(main);
    expect(m).not.toBeNull();
    const allowed = [...(m?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((x) => x[1]) as SecretFamily[];
    expect(allowed).not.toContain("bot");
    const env = { [CONFIRM_PRIVATE_KEY_VAR]: keys.privateKey };
    expect(() => refuseForeignSecrets("L'agent sécurité", allowed, env)).toThrow(
      /must not hold CENACLE_CONFIRM_PRIVATE_KEY/,
    );
  });
});
