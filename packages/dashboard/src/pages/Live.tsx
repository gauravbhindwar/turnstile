import { useEffect, useRef, useState } from "react";
import { subscribeToEvents } from "../lib/sse.js";
import type { ActionEvent, Decision, OutcomeEvent, TimelineEntry } from "../types.js";

const MAX_ROWS = 200;

const OUTCOME_STYLES: Record<string, string> = {
  allow: "bg-emerald-950 text-emerald-400 border-emerald-800",
  deny: "bg-red-950 text-red-400 border-red-800",
  escalate: "bg-amber-950 text-amber-400 border-amber-800",
  transform: "bg-sky-950 text-sky-400 border-sky-800",
  pending: "bg-neutral-800 text-neutral-400 border-neutral-700 animate-pulse",
};

function OutcomeChip({ outcome }: { outcome: string }) {
  const style = OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES.pending;
  return <span className={`px-2 py-0.5 rounded border text-xs uppercase tracking-wide ${style}`}>{outcome}</span>;
}

export default function Live() {
  const [rows, setRows] = useState<TimelineEntry[]>([]);
  const [selected, setSelected] = useState<TimelineEntry | null>(null);
  const [connected, setConnected] = useState(false);
  const rowsRef = useRef<TimelineEntry[]>([]);

  useEffect(() => {
    const handle = subscribeToEvents(
      (type, data) => {
        setConnected(true);
        if (type === "action") {
          const action = data as ActionEvent;
          const next = [{ action, decision: null, outcome: null }, ...rowsRef.current].slice(0, MAX_ROWS);
          rowsRef.current = next;
          setRows(next);
        } else if (type === "decision") {
          const decision = data as Decision;
          const next = rowsRef.current.map((r) => (r.action.eventId === decision.actionEventId ? { ...r, decision } : r));
          rowsRef.current = next;
          setRows(next);
        } else if (type === "outcome") {
          const outcome = data as OutcomeEvent;
          const next = rowsRef.current.map((r) => (r.action.eventId === outcome.actionEventId ? { ...r, outcome } : r));
          rowsRef.current = next;
          setRows(next);
        }
      },
      () => setConnected(false),
    );
    return () => handle.close();
  }, []);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800 text-xs text-neutral-500">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-neutral-600"}`} />
          {connected ? "live" : "connecting…"} — {rows.length} events this session
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500 border-b border-neutral-800">
            <tr>
              <th className="px-4 py-2 font-normal">time</th>
              <th className="px-4 py-2 font-normal">agent</th>
              <th className="px-4 py-2 font-normal">kind</th>
              <th className="px-4 py-2 font-normal">target</th>
              <th className="px-4 py-2 font-normal">outcome</th>
              <th className="px-4 py-2 font-normal">cost</th>
              <th className="px-4 py-2 font-normal">latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.action.eventId}
                onClick={() => setSelected(row)}
                className="border-b border-neutral-900 hover:bg-neutral-900 cursor-pointer"
              >
                <td className="px-4 py-2 text-neutral-500">{new Date(row.action.ts).toLocaleTimeString()}</td>
                <td className="px-4 py-2">{row.action.principal.agentName}</td>
                <td className="px-4 py-2 text-neutral-400">{row.action.kind}</td>
                <td className="px-4 py-2 text-neutral-300">{row.action.resource.target}</td>
                <td className="px-4 py-2">
                  <OutcomeChip outcome={row.decision?.outcome ?? "pending"} />
                </td>
                <td className="px-4 py-2 text-neutral-400">{row.outcome?.usage ? `$${row.outcome.usage.costUsd.toFixed(6)}` : "—"}</td>
                <td className="px-4 py-2 text-neutral-500">{row.outcome ? `${row.outcome.latencyMs.toFixed(0)}ms` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-neutral-600">
                  No events yet. Point an agent at this gateway — try{" "}
                  <code className="text-neutral-400">examples/05-spend-cap-demo</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="w-[420px] border-l border-neutral-800 overflow-y-auto p-4 text-xs">
          <div className="flex justify-between items-center mb-3">
            <span className="text-neutral-500 uppercase tracking-wide">Exchange detail</span>
            <button onClick={() => setSelected(null)} className="text-neutral-500 hover:text-neutral-300">
              close
            </button>
          </div>
          <div className="space-y-1 mb-4">
            <div>
              <span className="text-neutral-500">traceId </span>
              {selected.action.traceId}
            </div>
            <div>
              <span className="text-neutral-500">agent </span>
              {selected.action.principal.agentName} ({selected.action.principal.agentId})
            </div>
            <div>
              <span className="text-neutral-500">class </span>
              {selected.action.actionClass}
            </div>
          </div>

          {selected.decision && (
            <div className="mb-4">
              <div className="text-neutral-500 uppercase tracking-wide mb-1">Matched policies</div>
              {selected.decision.matchedPolicies.length === 0 && <div className="text-neutral-600">none matched</div>}
              {selected.decision.matchedPolicies.map((mp, i) => (
                <div key={i} className="border border-neutral-800 rounded p-2 mb-1">
                  <div className="flex justify-between">
                    <span>{mp.policyId}</span>
                    <span className="text-neutral-500">{mp.latencyMs.toFixed(1)}ms</span>
                  </div>
                  <div className="text-neutral-500">{mp.reason}</div>
                </div>
              ))}
              <div className="mt-2 text-neutral-400">{selected.decision.finalReason}</div>
            </div>
          )}

          {selected.outcome && (
            <div>
              <div className="text-neutral-500 uppercase tracking-wide mb-1">Outcome</div>
              <pre className="bg-neutral-900 rounded p-2 overflow-x-auto">{JSON.stringify(selected.outcome, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
