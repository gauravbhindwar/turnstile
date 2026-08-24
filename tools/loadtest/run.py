#!/usr/bin/env python3
"""Turnstile perf smoke test (§18.2).

Fires non-streaming /v1/chat/completions traffic at a target RPS for a
fixed duration against a running gateway (5 active policies configured via
turnstile.yaml), then reads back each request's own OutcomeEvent from
the admin API to compute Turnstile's *added* latency — latencyMs minus
upstreamLatencyMs, i.e. exactly the overhead the gateway itself introduced,
not the fake upstream's response time. Writes a markdown report and exits
non-zero if the budget (p50 < 15ms, p99 < 50ms) or a regression against a
baseline report is violated.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

try:
    import psutil
except ImportError:  # optional — only needed for --gateway-pid RSS checks
    psutil = None

DEFAULT_BODY_PADDING = "x" * 900  # pads the request to roughly 1KB, per §18.2
RSS_BUDGET_MB = 300  # §18.2: "Memory < 300 MB RSS @ 10k events/hour"


@dataclass
class RunConfig:
    base_url: str
    admin_token: str
    agent_key: str
    agent_name: str
    rps: int
    duration_s: int
    report_out: Path
    baseline: Path | None
    enforce: bool
    p50_budget_ms: float
    p99_budget_ms: float
    regression_pct: float
    gateway_pid: int | None


async def fire_requests(cfg: RunConfig) -> tuple[int, int, float, float | None]:
    """Sends cfg.rps requests/sec for cfg.duration_s seconds. Returns
    (sent, failed, wall_clock_seconds, peak_rss_mb)."""
    total = cfg.rps * cfg.duration_s
    interval = 1.0 / cfg.rps
    sent = 0
    failed = 0
    peak_rss_mb: float | None = None
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": f"perf smoke test padding: {DEFAULT_BODY_PADDING}"}],
        "max_tokens": 16,
    }
    headers = {"authorization": f"Bearer {cfg.agent_key}", "content-type": "application/json"}

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=10.0) as client:

        async def one_request() -> None:
            nonlocal failed
            try:
                resp = await client.post(f"{cfg.base_url}/v1/chat/completions", json=payload, headers=headers)
                if resp.status_code != 200:
                    failed += 1
            except httpx.HTTPError:
                failed += 1

        tasks = []
        for i in range(total):
            tasks.append(asyncio.create_task(one_request()))
            sent += 1
            if cfg.gateway_pid is not None:
                sample = sample_rss_mb(cfg.gateway_pid)
                if sample is not None:
                    peak_rss_mb = sample if peak_rss_mb is None else max(peak_rss_mb, sample)
            if i < total - 1:
                await asyncio.sleep(interval)
        await asyncio.gather(*tasks)

    elapsed = time.perf_counter() - started
    return sent, failed, elapsed, peak_rss_mb


async def fetch_added_latencies(cfg: RunConfig, expected_count: int) -> list[float]:
    headers = {"authorization": f"Bearer {cfg.admin_token}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        agents_resp = await client.get(f"{cfg.base_url}/admin/v1/agents", headers=headers)
        agents_resp.raise_for_status()
        agent = next((a for a in agents_resp.json()["data"] if a["name"] == cfg.agent_name), None)
        if agent is None:
            raise RuntimeError(f"agent {cfg.agent_name!r} not found — was it created before the run?")

        events_resp = await client.get(
            f"{cfg.base_url}/admin/v1/events",
            params={"agent": agent["id"], "limit": expected_count + 20},
            headers=headers,
        )
        events_resp.raise_for_status()
        items = events_resp.json()["data"]

    latencies: list[float] = []
    for item in items:
        outcome = item.get("outcome")
        if outcome is None:
            continue
        latency_ms = outcome.get("latencyMs")
        upstream_ms = outcome.get("upstreamLatencyMs") or 0
        if latency_ms is None:
            continue
        latencies.append(latency_ms - upstream_ms)
    return latencies


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return float("nan")
    sorted_values = sorted(values)
    k = (len(sorted_values) - 1) * (pct / 100)
    f = int(k)
    c = min(f + 1, len(sorted_values) - 1)
    if f == c:
        return sorted_values[f]
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def sample_rss_mb(pid: int) -> float | None:
    if psutil is None:
        return None
    try:
        return psutil.Process(pid).memory_info().rss / (1024 * 1024)
    except psutil.Error:
        return None


def render_report(cfg: RunConfig, sent: int, failed: int, elapsed: float, latencies: list[float], peak_rss_mb: float | None) -> str:
    p50 = percentile(latencies, 50)
    p95 = percentile(latencies, 95)
    p99 = percentile(latencies, 99)
    lines = [
        "# Turnstile perf smoke report",
        "",
        f"- requests sent: {sent} ({cfg.rps} rps target, {cfg.duration_s}s)",
        f"- failed (non-200): {failed}",
        f"- wall clock: {elapsed:.2f}s",
        f"- samples with outcome recorded: {len(latencies)}",
        "",
        "## Added latency (gateway overhead: latencyMs - upstreamLatencyMs)",
        "",
        "| Percentile | ms | Budget | Status |",
        "|---|---|---|---|",
        f"| p50 | {p50:.2f} | < {cfg.p50_budget_ms} | {'PASS' if p50 < cfg.p50_budget_ms else 'FAIL'} |",
        f"| p95 | {p95:.2f} | — | — |",
        f"| p99 | {p99:.2f} | < {cfg.p99_budget_ms} | {'PASS' if p99 < cfg.p99_budget_ms else 'FAIL'} |",
        "",
    ]

    if peak_rss_mb is not None:
        rss_status = "PASS" if peak_rss_mb < RSS_BUDGET_MB else "FAIL"
        lines += [
            "## Gateway process RSS",
            "",
            f"- peak RSS during run: {peak_rss_mb:.1f}MB (budget: < {RSS_BUDGET_MB}MB) — {rss_status}",
            "",
        ]

    if cfg.baseline and cfg.baseline.exists():
        try:
            baseline = json.loads(cfg.baseline.read_text())
            base_p50 = baseline.get("p50_ms")
            if base_p50:
                regression = (p50 - base_p50) / base_p50 * 100
                verdict = "FAIL (regression)" if regression > cfg.regression_pct else "OK"
                lines += [
                    "## Regression vs baseline",
                    "",
                    f"- baseline p50: {base_p50:.2f}ms, current p50: {p50:.2f}ms, delta: {regression:+.1f}% — {verdict}",
                    "",
                ]
        except (json.JSONDecodeError, KeyError):
            lines.append("_(baseline file present but unreadable — skipped regression check)_\n")

    return "\n".join(lines)


def evaluate_gate(cfg: RunConfig, latencies: list[float], peak_rss_mb: float | None) -> bool:
    if not cfg.enforce:
        return True
    p50 = percentile(latencies, 50)
    p99 = percentile(latencies, 99)
    ok = p50 < cfg.p50_budget_ms and p99 < cfg.p99_budget_ms
    if peak_rss_mb is not None and peak_rss_mb >= RSS_BUDGET_MB:
        ok = False
    if cfg.baseline and cfg.baseline.exists():
        try:
            baseline = json.loads(cfg.baseline.read_text())
            base_p50 = baseline.get("p50_ms")
            if base_p50 and (p50 - base_p50) / base_p50 * 100 > cfg.regression_pct:
                ok = False
        except (json.JSONDecodeError, KeyError):
            pass
    return ok


async def main_async(cfg: RunConfig) -> int:
    total = cfg.rps * cfg.duration_s
    sent, failed, elapsed, peak_rss_mb = await fire_requests(cfg)
    latencies = await fetch_added_latencies(cfg, total)

    report = render_report(cfg, sent, failed, elapsed, latencies, peak_rss_mb)
    cfg.report_out.write_text(report, encoding="utf-8")
    print(report)

    # Machine-readable summary, usable as a future run's --baseline input.
    summary_path = cfg.report_out.with_suffix(".json")
    summary_path.write_text(
        json.dumps({"p50_ms": percentile(latencies, 50), "p99_ms": percentile(latencies, 99), "samples": len(latencies)}),
        encoding="utf-8",
    )

    passed = evaluate_gate(cfg, latencies, peak_rss_mb)
    return 0 if passed else 1


def parse_args(argv: list[str]) -> RunConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8787")
    parser.add_argument("--admin-token", required=True)
    parser.add_argument("--agent-key", required=True)
    parser.add_argument("--agent-name", default="perf-bot")
    parser.add_argument("--rps", type=int, default=50)
    parser.add_argument("--duration", type=int, default=10, dest="duration_s")
    parser.add_argument("--report-out", type=Path, default=Path(__file__).parent / "report.md")
    parser.add_argument("--baseline", type=Path, default=None)
    parser.add_argument("--no-enforce", action="store_false", dest="enforce")
    parser.add_argument("--p50-budget-ms", type=float, default=15.0)
    parser.add_argument("--p99-budget-ms", type=float, default=50.0)
    parser.add_argument("--regression-pct", type=float, default=25.0)
    parser.add_argument("--gateway-pid", type=int, default=None, help="PID of the running gateway process, for an RSS check (needs psutil)")
    args = parser.parse_args(argv)
    return RunConfig(
        base_url=args.base_url,
        admin_token=args.admin_token,
        agent_key=args.agent_key,
        agent_name=args.agent_name,
        rps=args.rps,
        duration_s=args.duration_s,
        report_out=args.report_out,
        baseline=args.baseline,
        enforce=args.enforce,
        p50_budget_ms=args.p50_budget_ms,
        p99_budget_ms=args.p99_budget_ms,
        regression_pct=args.regression_pct,
        gateway_pid=args.gateway_pid,
    )


def main() -> None:
    cfg = parse_args(sys.argv[1:])
    exit_code = asyncio.run(main_async(cfg))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
