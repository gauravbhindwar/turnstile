import { useState } from "react";
import { api } from "../lib/api.js";

interface BudgetUsage {
  reservedUsd: number;
  settledUsd: number;
}

const today = new Date().toISOString().slice(0, 10);

export default function Budgets() {
  const [scopeKey, setScopeKey] = useState("");
  const [windowKey, setWindowKey] = useState(today);
  const [usage, setUsage] = useState<BudgetUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!scopeKey.trim()) return;
    setError(null);
    try {
      const res = await api.get<{ data: BudgetUsage | null }>(
        `/admin/v1/budgets?scopeKey=${encodeURIComponent(scopeKey)}&windowKey=${encodeURIComponent(windowKey)}`,
      );
      setUsage(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-neutral-300 text-sm uppercase tracking-wide mb-2">Budgets</h2>
      <p className="text-neutral-500 text-xs mb-6">
        Look up a spend_cap counter by its scope key (<code>workspaceId:agentId:policyId</code>, or{" "}
        <code>workspaceId:*:policyId</code> for a workspace-scoped cap) and window key (e.g. <code>{today}</code> for a
        daily window).
      </p>

      <div className="flex gap-2 mb-6">
        <input
          value={scopeKey}
          onChange={(e) => setScopeKey(e.target.value)}
          placeholder="ws-1:agent-1:spend-cap-demo-bot"
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm flex-1 outline-none focus:border-neutral-600"
        />
        <input
          value={windowKey}
          onChange={(e) => setWindowKey(e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm w-32 outline-none focus:border-neutral-600"
        />
        <button onClick={() => void lookup()} className="bg-neutral-100 text-neutral-900 rounded px-4 py-1.5 text-sm font-medium">
          Look up
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {usage && (
        <div className="border border-neutral-800 rounded p-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-neutral-500">settled</span>
            <span>${usage.settledUsd.toFixed(6)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">reserved (in-flight)</span>
            <span>${usage.reservedUsd.toFixed(6)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
