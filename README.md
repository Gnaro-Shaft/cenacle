# Cénacle

> A small, trusted circle of AI agents that assists one person at work and at home — **local-first, observable, and never acting without the owner's approval**.

**Status: phase 4 — replies, on a fictional test mailbox.** Iris sorts, tracks and drafts; an executor sends only what the owner accepted. Real mailboxes come in phase 5. Follow the build in [`docs/`](docs/) (`phase-1.md` … `phase-4.md`).

## What it is

Cénacle is a personal team of AI agents. Each agent lives in a little box on a web page, as an animated character showing its state (resting, working, sick), and talks to its owner through that page and Telegram.

The first agent is **Iris**, the messenger, who handles email. Iris:

- **sorts** incoming mail into a few categories (deterministic rules first, a local model for the rest);
- **tracks** what is waiting for a reply (48 working hours);
- **alerts** at fixed times, or immediately for urgent client mail — counters only, never content;
- **drafts** replies from the owner's own templates, which the owner reads, edits and accepts on the page. **Nothing is ever sent without approval**, and a separate executor with no AI does the sending.

## Principles

- **Local-first.** Mail content never leaves the owner's machine: models run locally.
- **Propose, don't act.** Agents can only write *proposals*. A deterministic executor, with no AI in it, carries out an action **after** human approval, with a 2-minute undo delay and a daily limit.
- **Security by construction.** The agent that reads untrusted mail has no way to send, browse or write elsewhere. The security model does not rely on the model behaving well.
- **Compliance in code.** The GDPR register of processing activities is a file the code enforces: a data source that is not declared is not read.
- **Measured, not assumed.** Every milestone ends with a demonstration and published metrics, including adversarial tests and a set of trap emails.

## Getting started

Requirements: Node (see `.nvmrc`), Docker (PostgreSQL and the GreenMail test mail server), and [LM Studio](https://lmstudio.ai) serving a local model.

```bash
npm install
cp .env.example .env          # fill it in: every secret is generated locally (see the comments)
npm run db:up                 # PostgreSQL + GreenMail, bound to 127.0.0.1
npm run db:migrate
npm run mail:load -- --reset  # loads the fictional test mailbox
npm run check                 # lint + typecheck + tests
```

Then, each in its own terminal:

| Command | What it does |
|---|---|
| `npm run iris` | Iris's rhythm: collects every 15 min (8 h–20 h, weekdays), sorts, drafts replies for due follow-ups, alerts and recaps on Telegram |
| `npm run executor` | The only program that can send: what the owner accepted, after 2 minutes, to the test server, 20 a day at most |
| `npm run server` | The local API — prints the page link with this run's token (`#jeton=…`) |
| `npm run web` | The page (open the link printed by the server) |
| `npm run bot` | The Telegram bot (`/etat`, `/stop`) |

Useful one-shot commands: `mail:sort` (one collection pass), `iris:draft` (draft now), `proposal -- list | accept | refuse | cancel`, `mail:bench`, `alert:bench`, `draft:vote`, `draft:check`, `trames:demo`, `simulate -- <idle|work|wait-mac|sick|clear-demo>`.

Your own sorting rules and reply templates go in `regles.local.toml` and `trames.local.toml` (git-ignored; start from the `*.example.toml` files). Never commit real data: this repository is public.

## Stack

TypeScript · [Pi](https://github.com/badlogic/pi-mono) (agent core) · PostgreSQL · React · Server-Sent Events · Telegram · OpenTelemetry → Tempo → Grafana · local models via LM Studio · GreenMail (test mail server).

## Documentation

- [`docs/charte.md`](docs/charte.md) — the hard rules (French)
- [`docs/adr/`](docs/adr/) — architecture decision records (French)
- [`docs/phase-1.md`](docs/phase-1.md) … [`docs/phase-4.md`](docs/phase-4.md) — the build, milestone by milestone (French)
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability

## License

[Apache License 2.0](LICENSE).
