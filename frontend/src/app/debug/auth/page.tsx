"use client";

import { useEffect, useState } from "react";
import { getStoredToken, getStoredUser } from "@/lib/auth";
import { getDeviceId } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

interface DebugSnapshot {
  session_id: string;
  host_device_id: string | null;
  snapshot_user_id_set: boolean;
  created_at: string | null;
  matched_via?: string[];
}

interface DebugResponse {
  user_id: string;
  email: string;
  linked_device_count: number;
  linked_device_ids: string[];
  current_device_id: string;
  current_device_is_linked: boolean;
  visible_snapshots_count: number;
  visible_snapshots: DebugSnapshot[];
  orphan_count_for_current_device: number;
  orphan_snapshots_for_current_device: DebugSnapshot[];
}

export default function DebugAuthPage() {
  const [data, setData] = useState<DebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
    const token = getStoredToken();
    const deviceId = getDeviceId();

    if (!token) {
      setError("No token found. Please sign in first.");
      return;
    }

    fetch(`${API_URL}/api/debug/auth-status?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`${r.status}: ${text}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const stored = getStoredUser();

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Debug — Auth Status</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Origen actual: <code className="bg-secondary px-2 py-0.5 rounded">{origin}</code>
      </p>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!data && !error && (
        <p className="text-muted-foreground">Cargando...</p>
      )}

      {data && (
        <div className="space-y-4">
          <Card title="Cuenta">
            <Row label="Email" value={data.email} />
            <Row label="User ID" value={data.user_id} mono />
            <Row label="Stored user (localStorage)" value={stored?.email || "(none)"} />
          </Card>

          <Card title="Devices linkeados a tu cuenta">
            <Row label="Total" value={String(data.linked_device_count)} />
            <Row label="Device actual" value={data.current_device_id} mono />
            <Row
              label="¿El device actual está linkeado?"
              value={data.current_device_is_linked ? "Sí" : "No"}
            />
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1">Lista completa:</p>
              <ul className="space-y-1">
                {data.linked_device_ids.map((d) => (
                  <li key={d} className="text-xs font-mono bg-secondary px-2 py-1 rounded">
                    {d}
                    {d === data.current_device_id && (
                      <span className="ml-2 text-primary font-sans not-italic">← actual</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card title={`Boletas visibles (${data.visible_snapshots_count})`}>
            {data.visible_snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-2">Fecha</th>
                    <th className="py-1 pr-2">host_device_id</th>
                    <th className="py-1 pr-2">user_id en snapshot</th>
                    <th className="py-1">match</th>
                  </tr>
                </thead>
                <tbody>
                  {data.visible_snapshots.map((s) => (
                    <tr key={s.session_id} className="border-b border-border/30">
                      <td className="py-1 pr-2">{s.created_at?.slice(0, 10)}</td>
                      <td className="py-1 pr-2 font-mono">{s.host_device_id?.slice(0, 12)}…</td>
                      <td className="py-1 pr-2">{s.snapshot_user_id_set ? "sí" : "no"}</td>
                      <td className="py-1 text-primary">{s.matched_via?.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title={`Boletas huérfanas en ESTE device (${data.orphan_count_for_current_device})`}
            warning={data.orphan_count_for_current_device > 0}
          >
            <p className="text-xs text-muted-foreground mb-2">
              Boletas con <code>host_device_id</code> = device actual, que NO están linkeadas a tu cuenta.
              Si hay alguna, son las que tu localStorage ve pero el backend no asocia a tu user.
            </p>
            {data.orphan_snapshots_for_current_device.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-2">Fecha</th>
                    <th className="py-1 pr-2">session_id</th>
                    <th className="py-1">user_id en snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orphan_snapshots_for_current_device.map((s) => (
                    <tr key={s.session_id} className="border-b border-border/30">
                      <td className="py-1 pr-2">{s.created_at?.slice(0, 10)}</td>
                      <td className="py-1 pr-2 font-mono">{s.session_id.slice(0, 12)}…</td>
                      <td className="py-1">{s.snapshot_user_id_set ? "sí" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({
  title,
  children,
  warning,
}: {
  title: string;
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        warning ? "border-orange-500/40 bg-orange-500/5" : "border-border bg-card"
      }`}
    >
      <h2 className="font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
