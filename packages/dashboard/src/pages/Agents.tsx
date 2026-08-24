import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { Agent } from "../types.js";

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [newName, setNewName] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const res = await api.get<{ data: Agent[] }>("/admin/v1/agents");
      setAgents(res.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createAgent() {
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const created = await api.post<{ data: Agent }>("/admin/v1/agents", { name: newName.trim() });
      const keyRes = await api.post<{ data: { key: string } }>(`/admin/v1/agents/${created.data.id}/keys`);
      setIssuedKey(keyRes.data.key);
      setNewName("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-neutral-300 text-sm uppercase tracking-wide mb-4">Agents</h2>

      <div className="flex gap-2 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void createAgent()}
          placeholder="agent-name"
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm flex-1 outline-none focus:border-neutral-600"
        />
        <button
          onClick={() => void createAgent()}
          disabled={loading || !newName.trim()}
          className="bg-neutral-100 text-neutral-900 rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Create agent + key
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {issuedKey && (
        <div className="border border-amber-800 bg-amber-950/40 rounded p-4 mb-6">
          <div className="text-amber-400 text-xs uppercase tracking-wide mb-2">Save this key now — shown once</div>
          <code className="text-sm text-neutral-200 break-all">{issuedKey}</code>
          <div className="text-neutral-500 text-xs mt-2">
            Use as: <code>Authorization: Bearer {"<key>"}</code>
          </div>
          <button onClick={() => setIssuedKey(null)} className="mt-3 text-xs text-neutral-500 hover:text-neutral-300">
            dismiss
          </button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500 border-b border-neutral-800">
          <tr>
            <th className="py-2 font-normal">name</th>
            <th className="py-2 font-normal">workspace</th>
            <th className="py-2 font-normal">created</th>
            <th className="py-2 font-normal">status</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id} className="border-b border-neutral-900">
              <td className="py-2">{a.name}</td>
              <td className="py-2 text-neutral-500">{a.workspaceId}</td>
              <td className="py-2 text-neutral-500">{new Date(a.createdAt).toLocaleString()}</td>
              <td className="py-2">{a.disabled ? <span className="text-red-400">disabled</span> : <span className="text-emerald-400">active</span>}</td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-neutral-600">
                No agents yet — create one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
