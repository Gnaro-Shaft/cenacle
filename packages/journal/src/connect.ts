import { errorText } from "@cenacle/core";
import postgres, { type Sql } from "postgres";
import { appUrlFromEnv, executorUrlFromEnv } from "./migrate.ts";

/** Connects as the application role (INSERT and SELECT only). */
export function connectAsApp(database = "cenacle"): Sql {
  return postgres(appUrlFromEnv(database), { max: 2, onnotice: () => {} });
}

/**
 * The client a program holds its instance lock on (ADR-0023): one connection
 * of its own, never recycled — postgres recycles a connection after 30 to 60
 * minutes by default, which would drop the lock. After a cut, the library
 * opens a new session by itself, and the lock is taken again there. Not a
 * reserved connection of a pool: queried after a cut, one never answers and
 * throws where nothing can catch it (postgres 3.4.9).
 */
export function connectLockAsApp(database = "cenacle"): Sql {
  return postgres(appUrlFromEnv(database), {
    max: 1,
    max_lifetime: null,
    idle_timeout: 0,
    onnotice: () => {},
  });
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
export function connectOrQuit(role: "app" | "executor" | "lock" = "app"): Sql {
  try {
    if (role === "lock") return connectLockAsApp();
    return role === "app" ? connectAsApp() : connectAsExecutor();
  } catch (error) {
    console.error(`🛑 ${errorText(error)}`);
    process.exit(1);
  }
}
