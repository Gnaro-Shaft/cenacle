# Cénacle

> A small, trusted circle of AI agents that assists one person at work and at home — **local-first, observable, and never acting without the owner's approval**.

**Status: phases 5 and 6.** Iris reads the owner's real mailbox **read-only** since 2026-10-05 (no draft, no sending there yet); drafts and sending run on a fictional test mailbox. A second agent, the CTO, advises on code and security; a security agent and a mission prospector work alongside. Follow the build in [`docs/`](docs/) (`phase-1.md` … `phase-6.md`) and the measures in [`docs/mesures/`](docs/mesures/).

## What it is

Cénacle is a personal team of AI agents. Each agent has its card on a web page, a character in a ring whose colour says its state (resting, working, waiting for the owner, sick), and talks to its owner through that page and Telegram.

| Agent | What it does |
|---|---|
| **Iris**, the messenger | **Sorts** incoming mail into five boxes — clients and prospects, administrative, noise, mission alerts, to sort — deterministic rules first, a local model for the rest; **tracks** what waits for a reply (48 working hours); **alerts** with counters only, never content; **drafts** replies from the owner's own templates, sent only after the owner accepts them, by a separate executor with no AI. |
| **The CTO** | A local technical advisor: answers questions on the projects from their documentation and, read-only, their code; reviews a branch; explains security findings. It never acts. Its **veille** sends a daily digest of what moves in the owner's tools. |
| **The security agent** | A round every 15 minutes: the Mac's settings, dependency advisories, leaked secrets, the servers' bulletins. Findings are followed until fixed; a fix is prepared only after the owner's button, and merged by the owner. |
| **The prospector** | Reads the mission alerts of the freelance platforms (the « missions » box), extracts each mission with the local model, sorts it by rules (no intermediary, the owner's stack, rate and remote work) and puts it on a **board**; tells the owner on Telegram, with counters only. Missions spotted elsewhere are added by hand. It writes to nobody and applies nowhere. |
| **The sentinel** | A small server away from the Mac that listens for its heartbeats and warns when it goes silent. The page shows whether the beats get through. |

An **operator** carries out a closed catalogue of server actions, each one confirmed by the owner (ADR-0027).

## Principles

- **Local-first.** Mail content never leaves the owner's machine: models run locally (Ollama).
- **Propose, don't act.** Agents can only write *proposals*. A deterministic executor, with no AI in it, carries out an action **after** human approval, with a 2-minute undo delay and a daily limit.
- **Security by construction.** The agent that reads untrusted mail has no way to send, browse or write elsewhere. The security model does not rely on the model behaving well.
- **Compliance in code.** The GDPR register of processing activities and the AI register are files the code checks: a source that is not declared is not read, a table without a purge or a retention without its register line fails the build.
- **Measured, not assumed.** Every milestone ends with a demonstration and published metrics, including adversarial tests and a set of trap emails.

## Getting started

Requirements: Node (see `.nvmrc`), Docker (PostgreSQL and the GreenMail test mail server), and [Ollama](https://ollama.com) serving a local model on the same machine.

```bash
npm install
cp .env.example .env          # fill it in: every secret is generated locally (see the comments)
npm run db:up                 # PostgreSQL + GreenMail, bound to 127.0.0.1
npm run db:migrate
npm run mail:load -- --reset  # loads the fictional test mailbox
npm run check                 # lint + typecheck + tests
```

### Running

On the owner's Mac, the programs run under **launchd**: `npm run service -- install all` (or one name), `npm run service -- status all`; `npm run page` opens the page with this run's token. After a merge, the long-running services must be restarted to run the new code.

| Program | Rhythm |
|---|---|
| `iris` | every minute; collects every 15 min (8 h–20 h, weekdays), alerts and recaps on Telegram |
| `executor` | the only program that can send: what the owner accepted, after 2 minutes, 20 a day at most |
| `server`, `web` | the local API and the page |
| `bot` | the Telegram bot (`/etat`, `/cto`, findings' buttons) |
| `cto` | the CTO's local service, asked from the page, Telegram or `npm run cto -- "question"` |
| `veille` | the CTO's daily digest, at 8 h |
| `securite` | the security round, every 15 min |
| `operateur` | the server actions the owner confirmed, every minute |
| `prospection` | the mission prospector, every 15 min (8 h–20 h, weekdays) |

Useful one-shot commands: `mail:sort`, `mail:bench`, `mesure:rangement` (judge the sorting), `regles:domaines` and `prospection:releve` (exact domains and addresses for the rules — terminal only), `personne` (export or erase what is held on someone), `conformite`, `status`.

### Your own settings

Real configuration never goes in the repository (it is public): it lives in git-ignored files, each with a versioned example.

| File | What it holds |
|---|---|
| `cadre.local.toml` | the mailbox, the open processings, the retentions |
| `regles.local.toml` | sorting rules by exact domain; `[missions]` lists the exact alert addresses of the platforms |
| `trames.local.toml` | the reply templates |
| `prospection.local.toml` | the mission platforms (sender domain, link hosts) and the owner's profile (stack, minimum rate, remote work, places) |
| `veille.local.toml`, `securite.local.toml`, `serveurs.local.toml` | the CTO's project map, the projects the security agent watches, the servers |

## Stack

TypeScript · [Pi](https://github.com/badlogic/pi-mono) (agent core) · PostgreSQL · React · Server-Sent Events · Telegram · OpenTelemetry → Tempo → Grafana · local models via Ollama · GreenMail (test mail server).

## Documentation

- [`docs/charte.md`](docs/charte.md) — the hard rules (French)
- [`docs/adr/`](docs/adr/) — architecture decision records (French)
- [`docs/phase-1.md`](docs/phase-1.md) … [`docs/phase-6.md`](docs/phase-6.md) — the build, milestone by milestone (French)
- [`docs/conformite/`](docs/conformite/) — the registers, the information notice, the impact assessment (French)
- [`SECURITY.md`](SECURITY.md) — reporting a vulnerability

## License

[Apache License 2.0](LICENSE).
