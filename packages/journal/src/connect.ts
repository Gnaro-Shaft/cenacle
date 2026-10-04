import postgres, { type Sql } from "postgres";
import { executorUrlFromEnv, urlsFromEnv } from "./migrate.ts";

/** Connects as the application role (INSERT and SELECT only). */
export function connectAsApp(database = "cenacle"): Sql {
  return postgres(urlsFromEnv(database).appUrl, { max: 2, onnotice: () => {} });
}

/** Connects as the executor, the only role that may claim and close a sending (ADR-0013). */
export function connectAsExecutor(database = "cenacle"): Sql {
  return postgres(executorUrlFromEnv(database), { max: 2, onnotice: () => {} });
}
