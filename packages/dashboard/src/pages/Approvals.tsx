import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { subscribeToEvents } from "../lib/sse.js";

interface ApprovalSummary {
  agentName: string;
  agentId: string;
  workspaceId: string;
  kind: string;
  target: string;
  upstream: string;
  reason: string;
}

interface Approval {
  id: string;
  actionEventId: string;
  status: "pending" | "approved" | "denied" | "expired";
  summary: ApprovalSummary;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remainingS = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const label = remainingS >= 60 ? `${Math.floor(remainingS / 60)}m ${remainingS % 60}s` : `${remainingS}s`;
  return <span className={remainingS < 30 ? "text-amber-400" : "text-neutral-500"}>{label} left</span>;
}

export default function Approvals() {
  const [pending, setPending] = useState<Approval[]>([]);
  const [decidedHistory, setDecidedHistory] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      const res = await api.get<{ data: Approval[] }>("/admin/v1/approvals?status=pending");
      setPending(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const handle = subscribeToEvents((type, data) => {
      if (type === "approval") {
        const approval = data as Approval;
        setPending((prev) => prev.filter((a) => a.id !== approval.id));
        if (approval.status !== "pending") {
          setDecidedHistory((prev) => [approval, ...prev].slice(0, 50));
        }
      }
    });
    const interval = setInterval(() => void refresh(), 10_000);
    return () => {
      handle.close();
      clearInterval(interval);
    };
  }, []);

  async function decide(id: string, decision: "approved" | "denied") {
    setError(null);
    try {
      await api.post(`/admin/v1/approvals/${id}/decide`, { decision, note: noteDrafts[id] || undefined });
      setPending((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="p-6 max-w-3xl overflow-y-auto h-full">
      <h2 className="text-neutral-300 text-sm uppercase tracking-wide mb-4">Approvals</h2>
      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <div className="space-y-3 mb-8">
        {pending.map((a) => (
          <div key={a.id} className="border border-amber-800 bg-amber-950/20 rounded p-4">
            <div className="flex justify-between items-start mb-2">
              <div className="text-sm">
                <span className="text-neutral-200">{a.summary.agentName}</span>
                <span className="text-neutral-500"> wants </span>
                <span className="text-neutral-200">{a.summary.kind}</span>
                <span className="text-neutral-500"> on </span>
                <span className="text-neutral-200">{a.summary.target}</span>
              </div>
              <Countdown expiresAt={a.expiresAt} />
            </div>
            <div className="text-neutral-500 text-xs mb-3">{a.summary.reason}</div>
            <input
              value={noteDrafts[a.id] ?? ""}
              onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
              placeholder="optional note"
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs mb-3 outline-none focus:border-neutral-600"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void decide(a.id, "approved")}
                className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 rounded px-3 py-1 text-xs font-medium"
              >
                Approve
              </button>
              <button
                onClick={() => void decide(a.id, "denied")}
                className="bg-red-900 hover:bg-red-800 text-red-100 rounded px-3 py-1 text-xs font-medium"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
        {pending.length === 0 && <div className="text-neutral-600 text-sm">No pending approvals.</div>}
      </div>

      {decidedHistory.length > 0 && (
        <>
          <h3 className="text-neutral-500 text-xs uppercase tracking-wide mb-2">Decided this session</h3>
          <div className="space-y-1">
            {decidedHistory.map((a) => (
              <div key={a.id} className="flex justify-between text-xs py-1 border-b border-neutral-900">
                <span>
                  {a.summary.agentName} → {a.summary.target}
                </span>
                <span className={a.status === "approved" ? "text-emerald-400" : a.status === "denied" ? "text-red-400" : "text-neutral-500"}>
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
