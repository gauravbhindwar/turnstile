import type { ActionEvent } from "../types/action.js";
import type { ApprovalRow } from "../storage/types.js";
import type { Logger } from "../logging/logger.js";

export interface NotificationContext {
  approval: ApprovalRow;
  event: ActionEvent;
  reason: string;
  approvalUrl: string;
}

export interface Notifier {
  send(ctx: NotificationContext): Promise<void>;
}

// Off the hot path (fires after the approval is already parked), at-least-
// once with a couple of retries. Links point at the dashboard approval
// page, not Slack interactivity — deciding still requires the admin token
// (§11.2: "to avoid needing a Slack app in v0.x").
export class SlackNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(ctx: NotificationContext): Promise<void> {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Turnstile approval requested*\n` +
            `Agent: \`${ctx.event.principal.agentName}\`\n` +
            `Action: \`${ctx.event.kind}\` → \`${ctx.event.resource.target}\`\n` +
            `Reason: ${ctx.reason}`,
        },
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Review in dashboard" }, url: ctx.approvalUrl },
        ],
      },
    ];
    await this.postWithRetry({ blocks });
  }

  private async postWithRetry(body: unknown, attempt = 1): Promise<void> {
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`slack webhook responded ${res.status}`);
    } catch (err) {
      if (attempt >= 3) {
        this.logger.error({ err: (err as Error).message }, "slack notification failed after retries");
        return;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
      await this.postWithRetry(body, attempt + 1);
    }
  }
}

export class GenericWebhookNotifier implements Notifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(ctx: NotificationContext): Promise<void> {
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvalId: ctx.approval.id,
          agent: ctx.event.principal.agentName,
          kind: ctx.event.kind,
          target: ctx.event.resource.target,
          reason: ctx.reason,
          approvalUrl: ctx.approvalUrl,
          expiresAt: ctx.approval.expiresAt,
        }),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, "generic webhook notification failed");
    }
  }
}
