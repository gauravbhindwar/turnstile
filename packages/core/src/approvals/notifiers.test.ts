import { describe, it, expect, vi } from "vitest";
import { SlackNotifier, GenericWebhookNotifier } from "./notifiers.js";
import { createLogger } from "../logging/logger.js";
import { makeActionEvent } from "../policy/testUtils.js";
import type { ApprovalRow } from "../storage/types.js";

const logger = createLogger({ level: "silent", format: "json" });

const approval: ApprovalRow = {
  id: "appr-1",
  actionEventId: "evt-1",
  status: "pending",
  summary: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:05:00.000Z",
  decidedAt: null,
  decidedBy: null,
  note: null,
};

describe("SlackNotifier", () => {
  it("posts a Block Kit message with a dashboard link (not Slack interactivity)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notifier = new SlackNotifier("https://hooks.slack.test/x", logger, fetchMock as unknown as typeof fetch);

    await notifier.send({ approval, event: makeActionEvent(), reason: "cap breach", approvalUrl: "http://x/app/approvals/appr-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.test/x");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.blocks[1].elements[0].url).toBe("http://x/app/approvals/appr-1");
  });

  it("retries on failure and eventually gives up without throwing", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const notifier = new SlackNotifier("https://hooks.slack.test/x", logger, fetchMock as unknown as typeof fetch);

      const sendPromise = notifier.send({ approval, event: makeActionEvent(), reason: "r", approvalUrl: "http://x" });
      await vi.runAllTimersAsync();
      await sendPromise;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GenericWebhookNotifier", () => {
  it("posts a JSON summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notifier = new GenericWebhookNotifier("https://example.test/hook", logger, fetchMock as unknown as typeof fetch);

    await notifier.send({ approval, event: makeActionEvent(), reason: "cap breach", approvalUrl: "http://x/app/approvals/appr-1" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.approvalId).toBe("appr-1");
    expect(body.reason).toBe("cap breach");
  });

  it("swallows a failed delivery (logs, does not throw)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const notifier = new GenericWebhookNotifier("https://example.test/hook", logger, fetchMock as unknown as typeof fetch);
    await expect(
      notifier.send({ approval, event: makeActionEvent(), reason: "r", approvalUrl: "http://x" }),
    ).resolves.toBeUndefined();
  });
});
