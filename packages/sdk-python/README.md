# turnstile-sdk (Python)

Python SDK for the generic Action API (§7.3/§7.4) — a thin `httpx` client,
zero business logic. Same wire format as `@turnstile/sdk` (TypeScript);
both are tested against the same fixtures in
[`tools/sdk-contract/fixtures.json`](../../tools/sdk-contract/fixtures.json).

```python
from turnstile_sdk import Turnstile, TurnstileError

turnstile = Turnstile("http://localhost:8787", os.environ["TURNSTILE_AGENT_KEY"])

# Guard, execute yourself, report the outcome.
guarded = turnstile.guard("send_email", {"to": "a@b.com"}, resource={"upstream": "sendgrid"})
if not guarded.allowed:
    raise RuntimeError("blocked")
result = send_email(...)
guarded.report({"status": "success", "latencyMs": 42})

# Or use the decorator to guard + execute + report automatically.
@turnstile.guarded("send_email", resource={"upstream": "sendgrid"})
def send_email(to: str) -> str:
    ...
```

## Development

```bash
pip install -e ".[dev]"
pytest
```
