// The veille (J5, ADR-0024): its pieces, for the `veille` program.
export { AI_NOTICE, formatDigest, type Kept, TELEGRAM_MAX } from "./digest.ts";
export { type FeedItem, type FeedRead, parseFeed, readFeeds } from "./feeds.ts";
export { NOT_DONE, runVeille, selectItems, type VeilleDeps, type VeilleOutcome } from "./run.ts";
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
