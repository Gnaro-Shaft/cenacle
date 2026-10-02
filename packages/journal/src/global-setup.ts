import { resetTestDatabase } from "./test-db.ts";

export default async function setup(): Promise<void> {
  await resetTestDatabase();
}
