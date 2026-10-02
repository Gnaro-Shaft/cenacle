# Cénacle

> A small, trusted circle of AI agents that assists one person at work and at home — **local-first, observable, and never acting without the owner's approval**.

**Status: design phase.** Architecture decisions are written; no code yet. Follow the build in [`docs/phase-1.md`](docs/phase-1.md).

## What it is

Cénacle is a personal team of AI agents. Each agent lives in a little box on a web page, as an animated character showing its state (resting, working, sick), and talks to its owner through that page and Telegram.

The first agent is **Iris**, the messenger, who handles email. Iris:

- **sorts** incoming mail into a few categories (deterministic rules first, a local model for the rest);
- **tracks** what is waiting for a reply;
- **alerts** at fixed times, or immediately for urgent client mail;
- **drafts** replies that the owner reads, edits and approves. **Nothing is ever sent without approval.**

## Principles

- **Local-first.** Mail content never leaves the owner's machine: models run locally. A tiny remote VPS only acts as a content-free sentinel.
- **Propose, don't act.** Agents can only write *proposals*. A deterministic executor, with no AI in it, carries out an action **after** human approval.
- **Security by construction.** The agent that reads untrusted mail has no way to send, browse or write elsewhere. The security model does not rely on the model behaving well.
- **Compliance in code.** The GDPR register of processing activities is a file the code enforces: a data source that is not declared is not read.
- **Measured, not assumed.** Every milestone ends with a demonstration and published metrics, including adversarial tests and a set of trap emails.

## Stack

TypeScript · [Pi](https://github.com/badlogic/pi-mono) (agent core) · PostgreSQL · React (installable PWA) · Server-Sent Events · Telegram · OpenTelemetry → Tempo → Grafana · local models via LM Studio.

## Documentation

- [`docs/charte.md`](docs/charte.md) — the hard rules (French)
- [`docs/adr/`](docs/adr/) — architecture decision records (French)
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability

## License

[Apache License 2.0](LICENSE).
