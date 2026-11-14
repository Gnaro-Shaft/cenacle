/**
 * The dependencies held back on purpose (finding n° 242, 14/11): what
 * .github/dependabot.yml tells Dependabot never to propose, for npm. A major
 * version held back there is a decision, not a delay: npm_outdated stays
 * silent on it, and speaks again the day the rule is lifted.
 *
 * Only the form used here is understood — a name, and one lower bound:
 *     - dependency-name: "@scope/name"
 *       versions: [">=3.0.0"]
 * Anything else (another form, a range, a broken file) holds nothing back:
 * in doubt the check says more, never less. Pure: text in, rules out.
 */
import { NPM_NAME } from "./parse-npm.ts";

export interface HeldBack {
  readonly name: string;
  /** The first version Dependabot is told to leave alone. */
  readonly from: readonly [number, number, number];
}

const ECOSYSTEM = /^(\s*)-\s+package-ecosystem:\s*"?([a-z-]+)"?\s*(?:#.*)?$/;
const IGNORE = /^(\s*)ignore:\s*(?:#.*)?$/;
const NAME = /^\s*-\s+dependency-name:\s*"?([^"\s#]+)"?\s*(?:#.*)?$/;
const VERSIONS =
  /^\s*versions:\s*\[\s*"\s*>=\s*(\d{1,6})\.(\d{1,6})\.(\d{1,6})\s*"\s*\]\s*(?:#.*)?$/;

const indent = (line: string) => line.length - line.trimStart().length;

/** The npm rules of a dependabot.yml; [] for anything not understood. */
export function heldBackRules(text: string): HeldBack[] {
  const rules: HeldBack[] = [];
  let ecosystem = "";
  let ignoreAt = -1;
  // The rule being read: kept only if it holds a name and one bound, nothing
  // else — `update-types` beside `versions` holds back less than every version.
  let item: { name: string | null; from: HeldBack["from"] | null; other: boolean } | null = null;
  const close = () => {
    if (item?.name && item.from && !item.other) rules.push({ name: item.name, from: item.from });
    item = null;
  };
  for (const line of text.split(/\r?\n/).slice(0, 2000)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const eco = ECOSYSTEM.exec(line);
    if (eco !== null) {
      close();
      ecosystem = eco[2] ?? "";
      ignoreAt = -1;
      continue;
    }
    if (ignoreAt >= 0 && indent(line) <= ignoreAt) {
      close(); // the ignore list ended
      ignoreAt = -1;
    }
    const ignore = IGNORE.exec(line);
    if (ignore !== null) {
      ignoreAt = ecosystem === "npm" ? (ignore[1] ?? "").length : -1;
      continue;
    }
    if (ignoreAt < 0) continue;
    const dependency = NAME.exec(line);
    if (dependency !== null) {
      close();
      const candidate = dependency[1] ?? "";
      item = { name: NPM_NAME.test(candidate) ? candidate : null, from: null, other: false };
      continue;
    }
    if (item === null) continue;
    const versions = VERSIONS.exec(line);
    if (versions !== null && item.from === null) {
      item.from = [Number(versions[1]), Number(versions[2]), Number(versions[3])];
    } else {
      // Any other key, a second bound, another form: this rule holds nothing back.
      item.other = true;
    }
  }
  close();
  return rules;
}

/** Whether `version` of `pkg` falls in a rule: then it is held back on purpose. */
export function isHeldBack(rules: readonly HeldBack[], pkg: string, version: string): boolean {
  const parts = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/.exec(version);
  if (parts === null) return false;
  const v = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return rules.some((rule) => {
    if (rule.name !== pkg) return false;
    for (let i = 0; i < 3; i++) {
      const [a, b] = [v[i] ?? 0, rule.from[i] ?? 0];
      if (a !== b) return a > b;
    }
    return true;
  });
}
