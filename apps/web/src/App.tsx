import { AgentBox } from "./AgentBox.tsx";

export function App() {
  return (
    <main className="page">
      <h1>Cénacle</h1>
      <section className="grid" aria-label="Les agents">
        <AgentBox agent="iris" title="Iris" duty="Courrier" />
      </section>
    </main>
  );
}
