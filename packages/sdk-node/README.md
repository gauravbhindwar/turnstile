# @turnstile/sdk

TypeScript SDK for the generic Action API (§7.3/§7.4) — a thin HTTP client,
zero business logic. Same wire format as `turnstile-sdk` (Python); both are
tested against the same fixtures in
[`tools/sdk-contract/fixtures.json`](../../tools/sdk-contract/fixtures.json).

```ts
import { Turnstile } from "@turnstile/sdk";

const turnstile = new Turnstile("http://localhost:8787", process.env.TURNSTILE_AGENT_KEY!);

// Guard, execute yourself, report the outcome.
const guarded = await turnstile.guard("send_email", { to: "a@b.com" }, { resource: { upstream: "sendgrid" } });
if (!guarded.allowed) throw new Error("blocked");
const result = await sendEmail(/* ... */);
await guarded.report({ status: "success", latencyMs: 42 });

// Or let wrap() do guard + execute + report for you.
await turnstile.wrap("send_email", { to: "a@b.com" }, { resource: { upstream: "sendgrid" } }, () => sendEmail(/* ... */));
```
