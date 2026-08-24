import httpx
import pytest
import respx

from turnstile_sdk import Turnstile, TurnstileError


def _allow_response() -> dict:
    return {"data": {"allowed": True, "eventId": "e1", "traceId": "t1", "decision": {"outcome": "allow", "finalReason": "ok", "matchedPolicies": []}}}


def _deny_response() -> dict:
    return {"error": {"type": "turnstile_policy_block", "code": "TURNSTILE_POLICY_BLOCK", "reason": "blocked", "traceId": "t1"}}


@respx.mock
def test_guard_sends_evaluate_only_and_declared_fields() -> None:
    route = respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(200, json=_allow_response()))
    client = Turnstile("http://localhost:8787", "trn_x")
    client.guard("send_email", {"to": "a@b.com"}, class_="mutate", resource={"upstream": "sendgrid"})

    request = route.calls[0].request
    assert request.headers["authorization"] == "Bearer trn_x"
    import json as _json

    sent = _json.loads(request.content)
    assert sent["name"] == "send_email"
    assert sent["class"] == "mutate"
    assert sent["resource"] == {"upstream": "sendgrid"}
    assert sent["execution"] == {"mode": "evaluate_only"}


@respx.mock
def test_guard_raises_on_unexpected_status() -> None:
    respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(500, json={"error": {"code": "INTERNAL"}}))
    client = Turnstile("http://localhost:8787", "trn_x")
    with pytest.raises(TurnstileError):
        client.guard("x", {}, resource={"upstream": "u"})


@respx.mock
def test_report_posts_to_actions_outcome_when_allowed() -> None:
    respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(200, json=_allow_response()))
    outcome_route = respx.post("http://localhost:8787/actions/outcome").mock(return_value=httpx.Response(200, json={"data": {"recorded": True}}))

    client = Turnstile("http://localhost:8787", "trn_x")
    guarded = client.guard("x", {}, resource={"upstream": "u"})
    guarded.report({"status": "success", "latencyMs": 12})

    assert outcome_route.called
    import json as _json

    sent = _json.loads(outcome_route.calls[0].request.content)
    assert sent == {"status": "success", "latencyMs": 12, "eventId": "e1", "traceId": "t1"}


@respx.mock
def test_report_is_noop_when_denied() -> None:
    respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(403, json=_deny_response()))
    outcome_route = respx.post("http://localhost:8787/actions/outcome").mock(return_value=httpx.Response(200, json={}))

    client = Turnstile("http://localhost:8787", "trn_x")
    guarded = client.guard("x", {}, resource={"upstream": "u"})
    guarded.report({"status": "success"})

    assert not outcome_route.called


@respx.mock
def test_guarded_decorator_runs_fn_and_reports_success() -> None:
    respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(200, json=_allow_response()))
    outcome_route = respx.post("http://localhost:8787/actions/outcome").mock(return_value=httpx.Response(200, json={"data": {"recorded": True}}))

    client = Turnstile("http://localhost:8787", "trn_x")

    @client.guarded("send_email", resource={"upstream": "sendgrid"})
    def send(to: str) -> str:
        return f"sent to {to}"

    result = send("a@b.com")
    assert result == "sent to a@b.com"
    assert outcome_route.called


@respx.mock
def test_guarded_decorator_raises_and_skips_fn_when_denied() -> None:
    respx.post("http://localhost:8787/actions/execute").mock(return_value=httpx.Response(403, json=_deny_response()))

    client = Turnstile("http://localhost:8787", "trn_x")
    calls = []

    @client.guarded("send_email", resource={"upstream": "sendgrid"})
    def send(to: str) -> str:
        calls.append(to)
        return "should not happen"

    with pytest.raises(TurnstileError):
        send("a@b.com")
    assert calls == []
