// The veille (J5, ADR-0024): its pieces, for the `veille` program.
export { archiveMarkdown } from "./archive-format.ts";
export { AI_NOTICE, type Digest, formatDigest, type Kept, TELEGRAM_MAX } from "./digest.ts";
export { type FeedItem, type FeedRead, normalizeLink, parseFeed, readFeeds } from "./feeds.ts";
export {
  NOT_DONE,
  runVeille,
  selectItems,
  type VeilleDeps,
  type VeilleMemory,
  type VeilleOutcome,
} from "./run.ts";
export {
  buildVeillePrompt,
  parseScores,
  type Scored,
  ScoreError,
  VEILLE_SYSTEM_PROMPT,
} from "./score.ts";
export {
  loadVeilleConfig,
  type Project,
  parseProjects,
  parseSources,
  type Source,
  type VeilleConfig,
  VeilleConfigError,
} from "./sources.ts";
