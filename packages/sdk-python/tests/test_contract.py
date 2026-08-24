"""Same fixtures drive the TS SDK's contract test
(packages/sdk-node/src/contract.test.ts) — proves both SDKs interpret the
wire format identically without needing a live gateway.
"""

import json
from pathlib import Path

import httpx
import pytest
import respx

from turnstile_sdk import Turnstile

FIXTURES_PATH = Path(__file__).resolve().parents[3] / "tools" / "sdk-contract" / "fixtures.json"
FIXTURES = json.loads(FIXTURES_PATH.read_text())


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_contract_fixture(fixture: dict) -> None:
    with respx.mock:
        respx.post("http://localhost:8787/actions/execute").mock(
            return_value=httpx.Response(fixture["mockResponse"]["status"], json=fixture["mockResponse"]["body"])
        )
        client = Turnstile("http://localhost:8787", "trn_test")
        guarded = client.guard("send_email", {"to": "x@example.com"}, resource={"upstream": "sendgrid"})

        assert guarded.allowed == fixture["expected"]["allowed"]
        if fixture["expected"]["allowed"]:
            assert guarded.decision["outcome"] == "allow"
        else:
            assert guarded.decision["code"] == fixture["expected"]["errorCode"]
