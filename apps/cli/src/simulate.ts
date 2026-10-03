/**
 * Writes demonstration events for an agent, as the application role.
 * Usage: npm run simulate -- <idle|work|wait-mac|sick|clear-demo> [agent]
 * Since phase 4 proposals are real (npm run iris:draft): the old "propose" and
 * "approve" scenarios are gone; "clear-demo" closes the demo proposals they left.
 */
import { projectStatus } from "@cenacle/core";
import { connectAsApp, createJournal, type NewEvent, readAllEvents } from "@cenacle/journal";

const [scenario, agent = "iris"] = process.argv.slice(2);
const sql = connectAsApp();
const journal = createJournal(sql);
const state = (to: string): NewEvent => ({ agent, type: "state.changed", payload: { to } });

async function eventsFor(name: string | undefined): Promise<NewEvent[]> {
  if (name !== "clear-demo") return [await eventFor(name)];
  const status = projectStatus(agent, await readAllEvents(journal, agent));
  return status.pendingProposalIds
    .filter((id) => id.startsWith("demo-"))
    .map((proposalId) => ({
      agent,
      type: "proposal.closed",
      payload: { proposalId, outcome: "lapsed" },
    }));
}

async function eventFor(name: string | undefined): Promise<NewEvent> {
  switch (name) {
    case "idle":
      return state("idle");
    case "work":
      return state("thinking");
    case "wait-mac":
      return state("waiting_for_local_model");
    case "sick":
      return state("error");
    default:
      throw new Error(
        `Unknown scenario ${JSON.stringify(name)} — use idle, work, wait-mac, sick or clear-demo`,
      );
  }
}

try {
  const events = await eventsFor(scenario);
  if (events.length === 0) console.log("✔ rien à faire");
  for (const e of events) {
    const event = await journal.append(e);
    console.log(`✔ #${event.id} ${event.type} ${JSON.stringify(event.payload)}`);
  }
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
