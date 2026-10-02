import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          // Every package and app except the journal, whose tests need a database.
          include: ["packages/!(journal)/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
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
    ],
  },
});
