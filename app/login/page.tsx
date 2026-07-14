"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal masuk.");
        setLoading(false);
        return;
      }
      // Berhasil — arahkan ke dashboard (peran ditentukan di sana)
      router.push("/dashboard");
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-ink px-4 overflow-hidden">
      {/* Latar berkarakter tapi tenang: glow aksen samar + garis hairline — murni dekoratif */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(560px 380px at 50% 32%, color-mix(in srgb, var(--color-accent) 7%, transparent), transparent 70%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-line" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" />

      <div className="relative w-full max-w-sm">
        {/* Identitas: monogram + wordmark */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-2 bg-surface text-sm font-semibold tracking-tight text-fg">
            RS
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-fg">Report Studio</h1>
          <p className="mt-1 text-xs text-fg-3">Laporan performa, dirangkai otomatis</p>
        </div>

        <div className="card p-7">
          <div className="space-y-4">
            <div>
              <label className="label-sm mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="input w-full"
                placeholder="email@contoh.com"
              />
            </div>
            <div>
              <label className="label-sm mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="input w-full"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="btn-primary w-full py-2.5"
            >
              {loading ? "Memproses…" : "Masuk"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}