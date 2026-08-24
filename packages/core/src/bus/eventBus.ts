import { EventEmitter } from "node:events";
import type { ActionEvent, Decision, OutcomeEvent } from "../types/action.js";
import type { ApprovalRow } from "../storage/types.js";

export interface ExchangeSummary {
  action: ActionEvent;
  decision: Decision | null;
  outcome: OutcomeEvent | null;
}

export type BusEvent =
  | { type: "action"; data: ActionEvent }
  | { type: "decision"; data: Decision }
  | { type: "outcome"; data: OutcomeEvent }
  | { type: "approval"; data: ApprovalRow };

// In-process pub/sub for the dashboard's SSE stream (§4 stage 7, D7). One
// process, no external broker — Admin API routes subscribe per connection.
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: BusEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
