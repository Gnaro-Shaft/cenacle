# Cénacle — rules for coding agents

- Read `docs/charte.md` first: its hard rules override convenience, always. When in doubt, the most protective rule wins.
- Architecture decisions live in `docs/adr/`. Do not contradict an accepted ADR; propose a new one instead.
- Code, identifiers and code comments are in **English**. ADRs and design docs are in **French**.
- Never write real data in this repository: no real email address, hostname, tailnet name, IP, personal path or secret. Real configuration lives in `.env` / `*.local.toml`, which are git-ignored.
- A task is done when it has been **run**, not when it has been written. Every milestone ships with adversarial tests (`*.adversarial.test.ts`).
- 400 lines per file, maximum.
