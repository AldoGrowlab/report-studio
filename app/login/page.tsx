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
    <div className="min-h-screen bg-ink lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* Panel BRAND (kiri di desktop, band atas di mobile): monogram besar + wordmark +
          tagline di atas tekstur grid hairline & glow aksen — karakter tapi tenang. */}
      <div className="bg-grid-texture relative flex flex-col justify-between overflow-hidden border-b border-line px-8 py-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-surface text-xs font-semibold tracking-tight text-fg">
            RS
          </div>
          <span className="text-sm font-medium tracking-tight text-fg-2">Report Studio</span>
        </div>

        <div className="py-14 lg:py-0">
          <p className="label-sm">Internal tools · Growlab</p>
          <h1 className="mt-4 max-w-md text-4xl font-semibold leading-tight tracking-tight text-fg lg:text-5xl">
            Laporan performa,
            <br />
            <span className="text-accent-hi">dirangkai otomatis.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-fg-2">
            Screenshot masuk, angka diekstrak presisi, insight tersusun, PPT jadi —
            satu alur untuk Shopee &amp; TikTok.
          </p>
        </div>

        <p className="hidden text-xs text-fg-3 lg:block">
          Monthly report yang konsisten, dari upload sampai slide.
        </p>
      </div>

      {/* Panel FORM (kanan): fungsional persis sama — 2 input + 1 tombol + error/loading */}
      <div className="flex items-center justify-center px-6 py-14 lg:px-14">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight text-fg">Masuk</h2>
          <p className="mt-1 text-sm text-fg-3">Pakai akun yang dibuatkan founder.</p>

          <div className="mt-8 space-y-5">
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