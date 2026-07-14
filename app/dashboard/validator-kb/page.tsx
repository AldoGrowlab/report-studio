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
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Dashboard
        </button>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">KB Validator</h1>
        <p className="mt-1.5 text-sm text-fg-3">
          Dua knowledge base per platform untuk Narrative Validator: cara merangkai section
          jadi satu cerita, dan cara menulis slide kesimpulan. Boleh kosong — Validator
          memakai penilaian umum sampai diisi.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-fg-3">Memuat…</p>
        ) : (
          <div className="mt-8 grid items-start gap-5 lg:grid-cols-2">
            {kbs.map((row) => (
              <div
                key={row.platform}
                className="card p-6"
              >
                <h2 className="text-lg font-semibold tracking-tight">{PLATFORM_LABEL[row.platform]}</h2>

                <label className="label-sm mt-5 block">
                  KB general / merangkai
                </label>
                <textarea
                  value={row.kbGeneral}
                  onChange={(e) => updateField(row.platform, "kbGeneral", e.target.value)}
                  rows={5}
                  placeholder="Bagaimana section-section dirangkai jadi satu cerita utuh sesuai gaya agency…"
                  className="textarea mt-1.5 w-full"
                />

                <label className="label-sm mt-5 block">
                  KB kesimpulan
                </label>
                <textarea
                  value={row.kbConclusion}
                  onChange={(e) => updateField(row.platform, "kbConclusion", e.target.value)}
                  rows={5}
                  placeholder="Bagaimana menulis slide kesimpulan yang baik…"
                  className="textarea mt-1.5 w-full"
                />

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => save(row)}
                    disabled={saving[row.platform]}
                    className="btn-primary"
                  >
                    {saving[row.platform] ? "Menyimpan…" : "Simpan"}
                  </button>
                  {message[row.platform] && (
                    <span
                      className={`text-xs ${message[row.platform] === "Tersimpan." ? "text-ok" : "text-danger"}`}
                    >
                      {message[row.platform]}
                    </span>
                  )}
                  {row.updatedAt && (
                    <span className="text-xs text-fg-3">
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
