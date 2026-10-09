import { errorText } from "@cenacle/core";
import postgres, { type Sql } from "postgres";
import { appUrlFromEnv, executorUrlFromEnv } from "./migrate.ts";

/** Connects as the application role (INSERT and SELECT only). */
export function connectAsApp(database = "cenacle"): Sql {
  return postgres(appUrlFromEnv(database), { max: 2, onnotice: () => {} });
}

/** Connects as the executor, the only role that may claim and close a sending (ADR-0013). */
export function connectAsExecutor(database = "cenacle"): Sql {
  return postgres(executorUrlFromEnv(database), { max: 2, onnotice: () => {} });
}

/**
 * Connects for a program's entry point, or quits: a missing or malformed
 * setting is said in one line and the program exits with 1. No stack trace:
 * it would print the absolute paths of the files, the home folder's name in
 * them, and a program run by launchd would keep them in its log file.
 */
export function connectOrQuit(role: "app" | "executor" = "app"): Sql {
  try {
    return role === "app" ? connectAsApp() : connectAsExecutor();
  } catch (error) {
    console.error(`🛑 ${errorText(error)}`);
    process.exit(1);
  }
}
