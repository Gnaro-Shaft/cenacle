// Test helper: takes a program's instance lock, says "locked", then waits to
// be killed (instance-lock.adversarial.test.ts).
import postgres from "postgres";
import { holdSingleInstance } from "./instance-lock.ts";

const sql = postgres(process.env.LOCK_URL ?? "", { max: 1, onnotice: () => {} });
const lock = await holdSingleInstance(sql, process.argv[2] ?? "");
if (lock === null) process.exit(2);
process.stdout.write("locked\n");
setInterval(() => {}, 60_000);
