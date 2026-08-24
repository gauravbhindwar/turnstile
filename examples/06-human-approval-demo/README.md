# 06 — Human-in-the-loop approval demo

A `require_approval` policy escalates every call from `approval-bot`. The
HTTP request genuinely parks — no response, no timeout, nothing — until a
human (here, `run.sh` standing in for one) decides it via the admin API,
which is exactly what clicking Approve/Deny in the dashboard's Approvals
page does.

```bash
pnpm build   # from the repo root, once
cd examples/06-human-approval-demo
./run.sh
```

Expected: the request fires and appears to hang; a pending approval shows
up in the queue with a rendered reason (`{{agent}}`/`{{target}}` filled
in); `run.sh` approves it; the originally-parked `curl` immediately
resumes and prints `HTTP 200` with the (fake) completion.

## Watching it in the dashboard instead

Run `./run.sh` but comment out the auto-approve step (or just open a
second terminal quickly) and open `http://localhost:8787/app` → Approvals
— you'll see the pending card with a live countdown, and clicking Approve
or Deny there does exactly what the script's `curl .../decide` call does.

## What happens on timeout

`policies/require-approval.yaml` sets `timeout_s: 120, on_timeout: deny` —
if nobody decides within 2 minutes, the parked request gets a `403
APPROVAL_TIMEOUT` automatically. Set `on_timeout: allow` to let it through
instead once the deadline passes. See
[docs/DESIGN.md](../../docs/DESIGN.md) for the full approval state machine.
