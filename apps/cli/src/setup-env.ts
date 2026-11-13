/**
 * The environment files of a fresh checkout (lot D5, 13/11). The README said
 * « cp .env.example .env »: a program then found secrets that are not its own
 * and refused to start, and the owner's, executor's and page's files did not
 * exist. Now every file is written at once, each family of secrets in its own
 * file (core/secrets.ts), every secret drawn here — never a value typed by
 * hand — and nothing a real mailbox or Telegram needs: those stay for me.
 */
import {
  CONFIRM_PRIVATE_KEY_VAR,
  CONFIRM_PUBLIC_KEY_VAR,
  familyOf,
  PRIVATE_KEY_VAR,
  PUBLIC_KEY_VAR,
  SECRET_FAMILIES,
} from "@cenacle/core";

export interface Drawn {
  /** n random bytes, as hex. */
  readonly hex: (bytes: number) => string;
  readonly acceptKeys: { readonly privateKey: string; readonly publicKey: string };
  readonly confirmKeys: { readonly privateKey: string; readonly publicKey: string };
}

/** The files a fresh checkout needs, by name; .env is the example with its values filled. */
export function setupFiles(example: string, drawn: Drawn): Map<string, string> {
  const secrets: Record<string, string> = {
    CENACLE_DB_OWNER_PASSWORD: drawn.hex(24),
    CENACLE_DB_EXECUTOR_PASSWORD: drawn.hex(24),
    CENACLE_TEST_MAIL_PASSWORD: drawn.hex(16),
    CENACLE_MAIL_KEY: drawn.hex(32),
    GRAFANA_ADMIN_PASSWORD: drawn.hex(16),
    [PRIVATE_KEY_VAR]: drawn.acceptKeys.privateKey,
    [CONFIRM_PRIVATE_KEY_VAR]: drawn.confirmKeys.privateKey,
  };
  const plain: Record<string, string> = {
    CENACLE_DB_APP_PASSWORD: drawn.hex(24),
    [PUBLIC_KEY_VAR]: drawn.acceptKeys.publicKey,
    [CONFIRM_PUBLIC_KEY_VAR]: drawn.confirmKeys.publicKey,
  };
  const files = new Map<string, string>();
  // .env: the example's lines, a secret of a family left out (it has its own file).
  const env = example
    .split("\n")
    .flatMap((line) => {
      const name = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
      if (name === undefined) return [line];
      if (familyOf(name) !== null) return [];
      return [name in plain ? `${name}=${plain[name]}` : line];
    })
    .join("\n");
  files.set(".env", `# Written by npm run setup. Never commit.\n${env}`);
  for (const family of Object.values(SECRET_FAMILIES)) {
    const lines = family.vars.flatMap((v) => (v in secrets ? [`${v}=${secrets[v]}`] : []));
    if (lines.length > 0) {
      files.set(family.file, `# Written by npm run setup. Never commit.\n${lines.join("\n")}\n`);
    }
  }
  return files;
}
