# @turnstile/dashboard

React + Vite + Tailwind admin dashboard, built statically and served by
`@turnstile/gateway` at `/app`.

M1 pages: **Live** (SSE-fed event stream with an exchange detail drawer —
matched policies, latencies, outcome), **Agents** (create an agent, issue a
key, one-time reveal), **Budgets** (look up a spend_cap scope's
reserved/settled usage). Sessions/Replay, Policies simulator, and Ledger
pages land in later milestones (see [DESIGN.md](../DESIGN.md)).

```bash
pnpm --filter @turnstile/dashboard build   # writes dist/, served at /app
pnpm --filter @turnstile/dashboard dev     # dev server on :5173, proxies /admin and /v1 to :8787
```
