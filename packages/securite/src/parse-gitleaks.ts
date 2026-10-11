/**
 * Reading `gitleaks git --redact --report-format json` (J6e2): a secret
 * committed in one of my projects. Only four fields are ever read — the rule,
 * the file, the line, the commit — each checked. The secret itself, the
 * matched line, the commit's author, e-mail and message are never read: even
 * a report gitleaks failed to redact leaks nothing into a finding, the journal
 * or a message. Each one is a high finding, to be rotated now.
 */
import { createHash } from "node:crypto";
import { plainOutput } from "./parse-mac.ts";
import { advisoryText } from "./parse-npm.ts";
import { CheckOutputError, type Observation } from "./types.ts";

const RULE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const COMMIT = /^[0-9a-f]{40}$/;
/** A path inside the repository, plain: anything else is not shown. */
const FILE = /^[A-Za-z0-9._@+-][A-Za-z0-9._@+/ -]{0,149}$/;
/** Beyond this, one finding tells how many more: a whole history must not flood the report. */
export const MAX_LEAKS = 20;

export function parseGitleaks(raw: string, project: string): Observation[] {
  let data: unknown;
  try {
    data = JSON.parse(plainOutput(raw));
  } catch {
    throw new CheckOutputError("gitleaks");
  }
  if (!Array.isArray(data)) throw new CheckOutputError("gitleaks");
  const leaks: Observation[] = [];
  for (const entry of data.slice(0, 5_000)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { RuleID, File, StartLine, Commit } = entry as Record<string, unknown>;
    if (typeof RuleID !== "string" || !RULE.test(RuleID)) continue;
    if (typeof Commit !== "string" || !COMMIT.test(Commit)) continue;
    if (typeof StartLine !== "number" || !Number.isSafeInteger(StartLine) || StartLine < 0)
      continue;
    // A file name comes from the repository: plain, and reading like no order.
    const file =
      typeof File === "string" &&
      FILE.test(File) &&
      !File.split("/").includes("..") &&
      advisoryText(File) === File
        ? File
        : null;
    const occurrence = createHash("sha256")
      .update(`${RuleID}\u0000${Commit}\u0000${String(File)}\u0000${StartLine}`)
      .digest("hex")
      .slice(0, 16);
    leaks.push({
      type: "projet_fuite",
      target: project,
      occurrence,
      severity: "eleve",
      title: `Projet ${project} : secret possible (${RuleID}) ${
        file === null ? "dans un fichier au nom inhabituel" : `dans ${file}`
      }, ligne ${StartLine}, commit ${Commit.slice(0, 7)}`,
      params: {
        project,
        rule: RuleID,
        commit: Commit.slice(0, 12),
        line: String(StartLine),
        ...(file === null ? {} : { file }),
      },
    });
  }
  const unique = [...new Map(leaks.map((l) => [l.occurrence, l])).values()];
  if (unique.length <= MAX_LEAKS) return unique;
  return [
    ...unique.slice(0, MAX_LEAKS),
    {
      type: "projet_fuite",
      target: project,
      occurrence: "autres",
      severity: "eleve",
      title: `Projet ${project} : et d'autres secrets possibles encore — lancer gitleaks dans le projet pour la liste`,
      params: { project, more: String(unique.length - MAX_LEAKS) },
    },
  ];
}
