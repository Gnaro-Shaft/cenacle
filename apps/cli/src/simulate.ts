/**
 * Writes demonstration events for an agent, as the application role.
 * Usage: npm run simulate -- <idle|work|wait-mac|sick|propose|approve> [agent]
 */
import { projectStatus } from "@cenacle/core";
import { connectAsApp, createJournal, type NewEvent, readAllEvents } from "@cenacle/journal";

const [scenario, agent = "iris"] = process.argv.slice(2);
const sql = connectAsApp();
const journal = createJournal(sql);
const state = (to: string): NewEvent => ({ agent, type: "state.changed", payload: { to } });

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
    case "propose":
      return {
        agent,
        type: "proposal.created",
        payload: { proposalId: `demo-${Date.now().toString(36)}` },
      };
    case "approve": {
      const status = projectStatus(agent, await readAllEvents(journal, agent));
      const [first] = status.pendingProposalIds;
      if (first === undefined) throw new Error("Nothing to approve: no pending proposal");
      return {
        agent,
        type: "proposal.closed",
        payload: { proposalId: first, outcome: "accepted" },
      };
    }
    default:
      throw new Error(
        `Unknown scenario ${JSON.stringify(name)} — use idle, work, wait-mac, sick, propose or approve`,
      );
  }
}

try {
  const event = await journal.append(await eventFor(scenario));
  console.log(`✔ #${event.id} ${event.type} ${JSON.stringify(event.payload)}`);
} catch (error) {
  console.error(`🛑 ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
