import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/core/src/**/*.test.ts", "apps/server/src/**/*.test.ts"],
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
