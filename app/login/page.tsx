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

  // Langkah pipeline (dekoratif, non-interaktif) — memperkuat cerita produk.
  const steps = ["Ekstrak", "Analisa", "Kesimpulan", "PPT"];

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink">
      {/* Animasi glow sangat halus — hanya di file ini, tidak menyentuh style global. */}
      <style>{`
        @keyframes rs-bloom { 0%,100% { opacity:.5; transform:translate3d(0,0,0) scale(1);} 50% { opacity:.85; transform:translate3d(0,-10px,0) scale(1.06);} }
        @keyframes rs-rise { from { opacity:0; transform:translateY(14px);} to { opacity:1; transform:none;} }
        .rs-rise { animation: rs-rise .6s ease-out both; }
      `}</style>

      {/* Satu kanvas gelap menyatu: tekstur grid + bloom membentang penuh (panel tak lagi terpisah tegas) */}
      <div aria-hidden className="bg-grid-texture pointer-events-none absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 24%, transparent), transparent 70%)",
          animation: "rs-bloom 10s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-0 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%)",
          animation: "rs-bloom 13s ease-in-out infinite reverse",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 px-6 py-14 lg:grid lg:grid-cols-2 lg:items-center lg:gap-20 lg:px-10">
        {/* ===== Brand ===== */}
        <div className="rs-rise">
          {/* Logo Growlab (putih via invert dari artwork hitam transparan) */}
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/growlab-logo.png"
              alt="Growlab"
              className="h-28 w-auto sm:h-32"
              style={{ filter: "invert(1)" }}
            />
            <span className="badge mt-5 inline-block bg-accent/15 text-sm text-accent-hi">
              Internal Tools
            </span>
          </div>

          <h1 className="mt-9 max-w-xl text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-fg lg:text-6xl">
            Laporan performa,
            <br />
            <span
              style={{
                background:
                  "linear-gradient(90deg, var(--color-accent-hi), color-mix(in srgb, var(--color-accent-hi) 55%, #ffffff))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              dirangkai otomatis.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-fg-2">
            Screenshot masuk, angka diekstrak presisi, insight tersusun, PPT jadi — satu alur
            untuk Shopee &amp; TikTok.
          </p>

          {/* Pipeline (dekoratif) */}
          <div className="mt-9 flex flex-wrap items-center gap-x-2.5 gap-y-2.5">
            {steps.map((s, i) => (
              <span key={s} className="flex items-center gap-2.5">
                <span className="rounded-lg border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium text-fg backdrop-blur-sm">
                  {s}
                </span>
                {i < steps.length - 1 && (
                  <span aria-hidden className="text-base text-accent-hi/70">
                    →
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* ===== Form (fungsional persis sama — 2 input + 1 tombol) ===== */}
        <div className="rs-rise flex justify-center lg:justify-end">
          <div
            className="card w-full max-w-md p-8 sm:p-10"
            style={{
              boxShadow:
                "0 40px 90px -45px color-mix(in srgb, var(--color-accent) 50%, transparent)",
            }}
          >
            <h2 className="text-2xl font-semibold tracking-tight text-fg">Masuk</h2>

            <div className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-fg-2">Email</label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="input w-full py-3 pl-11 text-base"
                    placeholder="email@contoh.com"
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-fg-2">Password</label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="input w-full py-3 pl-11 text-base"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-[10px] border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
                  {error}
                </p>
              )}

              <button
                onClick={handleLogin}
                disabled={loading}
                className="btn-primary w-full py-3 text-base"
              >
                {loading ? "Memproses…" : "Masuk"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
