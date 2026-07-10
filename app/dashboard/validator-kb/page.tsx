"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Tahap 7a — founder mengisi dua KB Validator per platform (DESIGN §Validator & Kesimpulan):
// KB general/merangkai (cara section jadi satu cerita sesuai gaya agency) dan KB kesimpulan
// (cara menulis slide kesimpulan yang baik). Boleh kosong — Validator tetap jalan dengan
// penilaian umum; founder mempertajam kapan saja.

type Platform = "shopee" | "tiktok";

type KbRow = {
  platform: Platform;
  kbGeneral: string;
  kbConclusion: string;
  updatedAt: string | null;
};

const PLATFORM_LABEL: Record<Platform, string> = {
  shopee: "Shopee",
  tiktok: "TikTok",
};

export default function ValidatorKbPage() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<Record<string, string>>({});

  // Muat awal di-inline (setState setelah await — lihat catatan lint di halaman sections).
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/validator-kb");
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setKbs(data.kbs || []);
      setLoading(false);
    })();
  }, [router]);

  function updateField(platform: Platform, field: "kbGeneral" | "kbConclusion", value: string) {
    setKbs((prev) => prev.map((k) => (k.platform === platform ? { ...k, [field]: value } : k)));
  }

  async function save(row: KbRow) {
    setSaving((p) => ({ ...p, [row.platform]: true }));
    setMessage((p) => ({ ...p, [row.platform]: "" }));
    try {
      const res = await fetch("/api/validator-kb", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: row.platform,
          kbGeneral: row.kbGeneral,
          kbConclusion: row.kbConclusion,
        }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setMessage((p) => ({ ...p, [row.platform]: data.error || "Gagal menyimpan." }));
        return;
      }
      setMessage((p) => ({ ...p, [row.platform]: "Tersimpan." }));
    } catch {
      setMessage((p) => ({ ...p, [row.platform]: "Kesalahan jaringan." }));
    } finally {
      setSaving((p) => ({ ...p, [row.platform]: false }));
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
        <h1 className="mt-4 text-2xl font-semibold">KB Validator</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Dua knowledge base per platform untuk Narrative Validator: cara merangkai section
          jadi satu cerita, dan cara menulis slide kesimpulan. Boleh kosong — Validator
          memakai penilaian umum sampai diisi.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-neutral-500">Memuat…</p>
        ) : (
          <div className="mt-8 space-y-8">
            {kbs.map((row) => (
              <div
                key={row.platform}
                className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"
              >
                <h2 className="text-lg font-medium">{PLATFORM_LABEL[row.platform]}</h2>

                <label className="mt-4 block text-xs font-medium text-neutral-400">
                  KB general / merangkai
                </label>
                <textarea
                  value={row.kbGeneral}
                  onChange={(e) => updateField(row.platform, "kbGeneral", e.target.value)}
                  rows={5}
                  placeholder="Bagaimana section-section dirangkai jadi satu cerita utuh sesuai gaya agency…"
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-neutral-500 focus:outline-none"
                />

                <label className="mt-4 block text-xs font-medium text-neutral-400">
                  KB kesimpulan
                </label>
                <textarea
                  value={row.kbConclusion}
                  onChange={(e) => updateField(row.platform, "kbConclusion", e.target.value)}
                  rows={5}
                  placeholder="Bagaimana menulis slide kesimpulan yang baik…"
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-neutral-500 focus:outline-none"
                />

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => save(row)}
                    disabled={saving[row.platform]}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {saving[row.platform] ? "Menyimpan…" : "Simpan"}
                  </button>
                  {message[row.platform] && (
                    <span
                      className={`text-xs ${message[row.platform] === "Tersimpan." ? "text-teal-300" : "text-red-400"}`}
                    >
                      {message[row.platform]}
                    </span>
                  )}
                  {row.updatedAt && (
                    <span className="text-xs text-neutral-500">
                      Terakhir disimpan {new Date(row.updatedAt).toLocaleString("id-ID")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
