import { useState } from "react";
import Live from "./pages/Live.js";
import Agents from "./pages/Agents.js";
import Budgets from "./pages/Budgets.js";
import { getAdminToken, setAdminToken, clearAdminToken } from "./lib/auth.js";

type Tab = "live" | "agents" | "budgets";

function TokenGate({ onReady }: { onReady: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-96">
        <h1 className="text-lg mb-1">Turnstile</h1>
        <p className="text-neutral-500 text-xs mb-4">
          Enter your admin token (from <code>warden.yaml</code>'s <code>admin.token</code> / the{" "}
          <code>TURNSTILE_ADMIN_TOKEN</code> env var). Kept in this browser's localStorage only.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              setAdminToken(value.trim());
              onReady();
            }
          }}
          placeholder="admin token"
          autoFocus
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm outline-none focus:border-neutral-600"
        />
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(getAdminToken());
  const [tab, setTab] = useState<Tab>("live");

  if (!token) {
    return <TokenGate onReady={() => setToken(getAdminToken())} />;
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-6">
          <span className="font-semibold">Turnstile</span>
          <nav className="flex gap-1 text-sm">
            {(["live", "agents", "budgets"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded capitalize ${tab === t ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        <button
          onClick={() => {
            clearAdminToken();
            setToken(null);
          }}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          sign out
        </button>
      </header>
      <main className="flex-1 overflow-hidden">
        {tab === "live" && <Live />}
        {tab === "agents" && <Agents />}
        {tab === "budgets" && <Budgets />}
      </main>
    </div>
  );
}
