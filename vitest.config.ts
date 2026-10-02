import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          // Every package and app except the journal, whose tests need a database,
          // and integration tests, which need the local services.
          include: ["packages/!(journal)/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "db",
          include: ["packages/journal/src/**/*.test.ts"],
          globalSetup: ["packages/journal/src/global-setup.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "services",
          include: ["**/src/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
          // Loading 146 mails into a cold GreenMail can take several seconds.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
