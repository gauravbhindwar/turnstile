"""Thin HTTP client over Turnstile's generic Action API (spec §7.3/§7.4).

Zero business logic here — the gateway does all enforcement. This module
mirrors @turnstile/sdk (TypeScript) field-for-field on the wire; the two
SDKs are tested against the same fixtures in tools/sdk-contract/.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

import httpx
from pydantic import BaseModel, Field


class ResourceRef(BaseModel):
    upstream: str
    target: Optional[str] = None
    method: Optional[str] = None


class DecisionInfo(BaseModel):
    outcome: str
    finalReason: str = Field(alias="finalReason")
    matchedPolicies: list = Field(default_factory=list, alias="matchedPolicies")

    model_config = {"populate_by_name": True}


class DenialInfo(BaseModel):
    type: str
    code: str
    reason: str
    policyId: Optional[str] = None
    approvalId: Optional[str] = None
    traceId: str

    model_config = {"populate_by_name": True}


class TurnstileError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


@dataclass
class Guarded:
    client: "Turnstile"
    allowed: bool
    decision: dict
    event_id: Optional[str] = None
    trace_id: Optional[str] = None

    def report(self, outcome: dict) -> None:
        """Reports an outcome for an allowed action. No-op if denied."""
        if not self.allowed or not self.event_id or not self.trace_id:
            return
        self.client.report_outcome(self.event_id, self.trace_id, outcome)


class Turnstile:
    def __init__(self, base_url: str, agent_key: str, *, http_client: Optional[httpx.Client] = None):
        self.base_url = base_url.rstrip("/")
        self.agent_key = agent_key
        self._client = http_client or httpx.Client()

    def guard(
        self,
        name: str,
        params: Any,
        *,
        resource: dict,
        class_: Optional[str] = None,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Guarded:
        headers = {"authorization": f"Bearer {self.agent_key}"}
        if trace_id:
            headers["x-turnstile-trace-id"] = trace_id
        if session_id:
            headers["x-turnstile-session-id"] = session_id

        response = self._client.post(
            f"{self.base_url}/actions/execute",
            headers=headers,
            json={
                "name": name,
                "class": class_,
                "resource": resource,
                "params": params,
                "execution": {"mode": "evaluate_only"},
            },
        )
        body = response.json()

        if response.status_code in (403, 503):
            error = body.get("error")
            if error is None:
                raise TurnstileError(f"unexpected response shape for status {response.status_code}", response.status_code)
            denial = DenialInfo.model_validate(error)  # validates the server's error shape
            return Guarded(self, False, denial.model_dump(), None, None)

        if response.status_code >= 400 or "data" not in body:
            raise TurnstileError(f"turnstile guard() failed: HTTP {response.status_code}", response.status_code)

        data = body["data"]
        decision = DecisionInfo.model_validate(data["decision"])  # validates the server's decision shape
        return Guarded(self, data["allowed"], decision.model_dump(), data["eventId"], data["traceId"])

    def report_outcome(self, event_id: str, trace_id: str, outcome: dict) -> None:
        payload = {**outcome, "eventId": event_id, "traceId": trace_id}
        response = self._client.post(
            f"{self.base_url}/actions/outcome",
            headers={"authorization": f"Bearer {self.agent_key}"},
            json=payload,
        )
        if response.status_code >= 400:
            raise TurnstileError(f"turnstile report_outcome() failed: HTTP {response.status_code}", response.status_code)

    def guarded(self, name: str, *, resource: dict, class_: Optional[str] = None) -> Callable:
        """Decorator: @client.guarded("send_email", class_="mutate", resource={"upstream": "sendgrid"})"""

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                params = {"args": [repr(a) for a in args], "kwargs": kwargs}
                g = self.guard(name, params, resource=resource, class_=class_)
                if not g.allowed:
                    reason = g.decision.get("reason", "denied")
                    raise TurnstileError(f"blocked by Turnstile policy: {reason}", 403)
                started = time.monotonic()
                try:
                    result = fn(*args, **kwargs)
                    g.report({"status": "success", "latencyMs": (time.monotonic() - started) * 1000})
                    return result
                except Exception as exc:
                    g.report({"status": "upstream_error", "latencyMs": (time.monotonic() - started) * 1000, "errorCode": str(exc)})
                    raise

            return wrapper

        return decorator
