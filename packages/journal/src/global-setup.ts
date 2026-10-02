import { resetTestDatabase } from "./test-db.js";

export default async function setup(): Promise<void> {
  await resetTestDatabase();
}
