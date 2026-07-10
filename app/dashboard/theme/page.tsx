"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SAFE_FONTS } from "@/lib/theme";

// Tahap 10 — tema global (founder): SATU tema aktif untuk semua report saat generate PPT
// (termasuk report lama — PPT dirakit on-the-fly dengan tema aktif). Warna, font (daftar
// aman PPTX), logo cover, dan override aksen per platform.

type ThemeRow = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  logoKey: string | null;
  accentOverride: boolean;
  accentShopee: string;
  accentTiktok: string;
};

function ColorInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-400">{label}</label>
      {hint && <p className="mt-0.5 text-[10px] text-neutral-600">{hint}</p>}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={`#${/^[0-9A-Fa-f]{6}$/.test(value) ? value : "000000"}`}
          onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-950"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^#/, "").toUpperCase())}
          maxLength={6}
          className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 font-mono text-xs text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}

export default function ThemePage() {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Cache-buster preview logo: naik setiap upload/hapus supaya <img> memuat ulang.
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoBusy, setLogoBusy] = useState(false);

  // Muat awal di-inline (setState setelah await — lihat catatan lint di halaman sections).
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/theme");
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setTheme(data.theme);
    })();
  }, [router]);

  function patch(p: Partial<ThemeRow>) {
    setTheme((t) => (t ? { ...t, ...p } : t));
    setMessage("");
  }

  async function save() {
    if (!theme) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(theme),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Gagal menyimpan tema.");
        return;
      }
      setTheme(data.theme);
      setMessage("Tersimpan — dipakai saat generate PPT berikutnya.");
    } catch {
      setMessage("Kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setMessage("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/theme/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Gagal mengunggah logo.");
        return;
      }
      setTheme(data.theme);
      setLogoVersion((v) => v + 1);
    } catch {
      setMessage("Kesalahan jaringan.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!window.confirm("Hapus logo dari tema?")) return;
    setLogoBusy(true);
    try {
      const res = await fetch("/api/theme/logo", { method: "DELETE" });
      if (res.ok) {
        setTheme((t) => (t ? { ...t, logoKey: null } : t));
        setLogoVersion((v) => v + 1);
      }
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Dashboard
        </button>
        <h1 className="mt-4 text-2xl font-semibold">Tema Bulanan</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Satu tema aktif untuk semua report. Perubahan langsung dipakai saat generate PPT
          berikutnya — termasuk report lama (PPT selalu dirakit dengan tema aktif).
        </p>

        {!theme ? (
          <p className="mt-8 text-sm text-neutral-500">Memuat…</p>
        ) : (
          <div className="mt-8 space-y-6">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-sm font-medium text-neutral-200">Warna</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <ColorInput
                  label="Primer"
                  hint="Panel cover, band kesimpulan, judul"
                  value={theme.primaryColor}
                  onChange={(v) => patch({ primaryColor: v })}
                />
                <ColorInput
                  label="Sekunder"
                  hint="Caption, footer, garis pemisah"
                  value={theme.secondaryColor}
                  onChange={(v) => patch({ secondaryColor: v })}
                />
                <ColorInput
                  label="Aksen"
                  hint="Bar judul, garis, panel insight"
                  value={theme.accentColor}
                  onChange={(v) => patch({ accentColor: v })}
                />
              </div>

              <label className="mt-5 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={theme.accentOverride}
                  onChange={(e) => patch({ accentOverride: e.target.checked })}
                  className="mt-0.5 accent-blue-500"
                />
                <span>
                  <span className="block text-sm text-neutral-200">
                    Override aksen per platform
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    Blok Shopee dan TikTok memakai aksen masing-masing (bukan aksen dasar).
                  </span>
                </span>
              </label>
              {theme.accentOverride && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <ColorInput
                    label="Aksen Shopee"
                    value={theme.accentShopee}
                    onChange={(v) => patch({ accentShopee: v })}
                  />
                  <ColorInput
                    label="Aksen TikTok"
                    value={theme.accentTiktok}
                    onChange={(v) => patch({ accentTiktok: v })}
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-sm font-medium text-neutral-200">Font</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Daftar font yang aman dibuka di PowerPoint Windows & Mac tanpa embed.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-neutral-400">Judul</label>
                  <select
                    value={theme.headingFont}
                    onChange={(e) => patch({ headingFont: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  >
                    {SAFE_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400">Body</label>
                  <select
                    value={theme.bodyFont}
                    onChange={(e) => patch({ bodyFont: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  >
                    {SAFE_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-sm font-medium text-neutral-200">Logo</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Muncul di cover PPT. Tanpa logo juga tidak apa-apa.
              </p>
              <div className="mt-3 flex items-center gap-4">
                {theme.logoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/theme/logo?v=${logoVersion}`}
                    alt="Logo"
                    className="h-16 max-w-40 rounded-lg border border-neutral-800 bg-white object-contain p-1.5"
                  />
                ) : (
                  <div className="flex h-16 w-28 items-center justify-center rounded-lg border border-dashed border-neutral-700 text-[10px] text-neutral-600">
                    belum ada logo
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer rounded-lg border border-neutral-700 px-3 py-1.5 text-center text-xs text-neutral-200 hover:bg-neutral-800">
                    {logoBusy ? "Memproses…" : theme.logoKey ? "Ganti logo" : "Unggah logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={logoBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadLogo(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {theme.logoKey && (
                    <button
                      onClick={removeLogo}
                      disabled={logoBusy}
                      className="text-xs text-neutral-500 hover:text-red-400"
                    >
                      Hapus logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? "Menyimpan…" : "Simpan tema"}
              </button>
              {message && (
                <span
                  className={`text-xs ${message.startsWith("Tersimpan") ? "text-teal-300" : "text-red-400"}`}
                >
                  {message}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
