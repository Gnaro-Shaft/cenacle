import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          // Every package and app except what needs a database (the journal, the
          // draft bench) and integration tests, which need the local services.
          include: ["packages/!(journal)/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: [
            "**/*.integration.test.ts",
            "apps/cli/src/draft-bench/**",
            "**/node_modules/**",
          ],
        },
      },
      {
        test: {
          name: "db",
          include: ["packages/journal/src/**/*.test.ts", "apps/cli/src/draft-bench/**/*.test.ts"],
          // The draft bench recreates the test database at each run: one file at a time.
          testTimeout: 60_000,
          globalSetup: ["packages/journal/src/global-setup.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "services",
          include: ["**/src/**/*.integration.test.ts"],
          // .claude/worktrees: other sessions' checkouts — their tests are not this tree's.
          exclude: ["**/node_modules/**", ".claude/**"],
          fileParallelism: false,
          // Loading 146 mails into a cold GreenMail can take several seconds.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
