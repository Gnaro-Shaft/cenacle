import postgres, { type Sql } from "postgres";
import { urlsFromEnv } from "./migrate.ts";

/** Connects as the application role (INSERT and SELECT only). */
export function connectAsApp(database = "cenacle"): Sql {
  return postgres(urlsFromEnv(database).appUrl, { max: 2, onnotice: () => {} });
}
