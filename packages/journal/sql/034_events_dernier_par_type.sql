-- The latest event of an agent among some types (lot F3, 13/11): latestEvent
-- reads one row through this index, even for a type that never happened —
-- without it, the backward scan of (agent, id) walked every event of the agent.
CREATE INDEX IF NOT EXISTS events_agent_type_id ON events (agent, type, id);
