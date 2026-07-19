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
    <div className="relative min-h-screen overflow-hidden bg-ink lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* Animasi glow sangat halus — hanya di file ini, tidak menyentuh style global. */}
      <style>{`
        @keyframes rs-bloom { 0%,100% { opacity:.55; transform:translate3d(0,0,0) scale(1);} 50% { opacity:.9; transform:translate3d(0,-10px,0) scale(1.06);} }
        @keyframes rs-rise { from { opacity:0; transform:translateY(12px);} to { opacity:1; transform:none;} }
        .rs-rise { animation: rs-rise .6s ease-out both; }
      `}</style>

      {/* ===== Panel BRAND ===== */}
      <div className="bg-grid-texture relative flex flex-col justify-between overflow-hidden border-b border-line px-8 py-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-14">
        {/* Bloom aksen berlapis */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 26%, transparent), transparent 70%)",
            animation: "rs-bloom 9s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent 70%)",
            animation: "rs-bloom 11s ease-in-out infinite reverse",
          }}
        />

        {/* Identitas */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold tracking-tight text-fg"
            style={{
              background:
                "linear-gradient(145deg, var(--color-surface-2), var(--color-surface))",
              boxShadow:
                "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, var(--color-line-2)), 0 8px 24px -14px color-mix(in srgb, var(--color-accent) 60%, transparent)",
            }}
          >
            RS
          </div>
          <span className="text-sm font-medium tracking-tight text-fg-2">Report Studio</span>
          <span className="badge ml-1 bg-accent/12 text-accent-hi">Growlab</span>
        </div>

        {/* Headline */}
        <div className="relative rs-rise py-14 lg:py-0">
          <p className="label-sm">Internal tools · Growlab</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-[1.08] tracking-tight text-fg lg:text-[3.25rem]">
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
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-fg-2">
            Screenshot masuk, angka diekstrak presisi, insight tersusun, PPT jadi —
            satu alur untuk Shopee &amp; TikTok.
          </p>

          {/* Pipeline (dekoratif) */}
          <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-2">
            {steps.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-lg border border-line bg-surface/70 px-3 py-1.5 text-xs font-medium text-fg-2 backdrop-blur-sm">
                  {s}
                </span>
                {i < steps.length - 1 && (
                  <span aria-hidden className="text-fg-3">
                    →
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        <p className="relative hidden text-xs text-fg-3 lg:block">
          Monthly report yang konsisten, dari upload sampai slide.
        </p>
      </div>

      {/* ===== Panel FORM (fungsional persis sama — 2 input + 1 tombol) ===== */}
      <div className="relative flex items-center justify-center px-6 py-14 lg:px-14">
        <div className="rs-rise w-full max-w-sm">
          <div
            className="card p-8"
            style={{
              boxShadow:
                "0 30px 80px -40px color-mix(in srgb, var(--color-accent) 45%, transparent)",
            }}
          >
            <h2 className="text-xl font-semibold tracking-tight text-fg">Masuk</h2>
            <p className="mt-1 text-sm text-fg-3">Pakai akun yang dibuatkan founder.</p>

            <div className="mt-8 space-y-5">
              <div>
                <label className="label-sm mb-1.5 block">Email</label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="input w-full pl-10"
                    placeholder="email@contoh.com"
                  />
                </div>
              </div>
              <div>
                <label className="label-sm mb-1.5 block">Password</label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="input w-full pl-10"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-[10px] border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <button
                onClick={handleLogin}
                disabled={loading}
                className="btn-primary w-full py-2.5"
              >
                {loading ? "Memproses…" : "Masuk"}
              </button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-fg-3">
            Report Studio · alur laporan performa online shop
          </p>
        </div>
      </div>
    </div>
  );
}
