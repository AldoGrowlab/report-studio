"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Platform = "shopee" | "tiktok";
type MetricType = "number" | "currency" | "percent" | "ratio" | "duration" | "text";

type MetricRow = {
  key: string;
  label: string;
  type: MetricType;
  required: boolean;
};

type SectionRow = {
  id: string;
  platform: Platform;
  name: string;
  narrativeOrder: number;
  status: "draft" | "active";
  kbAnalysis: string;
  usesPeriodComparison: boolean;
  metrics: MetricRow[];
};

const METRIC_TYPES: { value: MetricType; label: string }[] = [
  { value: "number", label: "Angka" },
  { value: "currency", label: "Rupiah" },
  { value: "percent", label: "Persen" },
  { value: "ratio", label: "Rasio" },
  { value: "duration", label: "Durasi" },
  // Teks (nama produk/affiliator): bukan angka — tidak pernah dihitung/dibandingkan,
  // dipasangkan dengan metrik angka ber-indeks sama (nama_produk_1 + penjualan_produk_1).
  { value: "text", label: "Teks" },
];

function emptyMetric(): MetricRow {
  return { key: "", label: "", type: "number", required: false };
}

export default function SectionsPage() {
  const router = useRouter();
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // State form (dipakai untuk buat & edit)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>("shopee");
  const [name, setName] = useState("");
  const [narrativeOrder, setNarrativeOrder] = useState("0");
  const [kbAnalysis, setKbAnalysis] = useState("");
  // Tahap 6b — section membandingkan performa antar bulan (penanda bulan per-foto saat upload).
  const [usesPeriodComparison, setUsesPeriodComparison] = useState(false);
  const [metrics, setMetrics] = useState<MetricRow[]>([emptyMetric()]);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Pesan kegagalan per baris section — terutama 409 "masih dipakai N foto" dari server,
  // yang sebelumnya dibuang sehingga tombol Hapus tampak rusak tanpa penjelasan.
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Pratinjau status: harus cocok dengan computeSectionStatus di server
  const filledMetrics = metrics.filter((m) => m.key.trim() && m.label.trim());
  const willBeActive =
    name.trim().length > 0 && kbAnalysis.trim().length > 0 && filledMetrics.length >= 1;

  // Refresh dari handler (simpan/hapus) — call site menyetel loading dulu.
  async function loadSections() {
    const res = await fetch("/api/sections");
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setSections(data.sections || []);
    setLoadingList(false);
  }

  // Muat awal di-inline (bukan panggil loadSections): lint set-state-in-effect menandai
  // fungsi lokal ber-setState yang dipanggil dari efek; inline membuat jelas setState
  // terjadi SETELAH await (asinkron), bukan sinkron di badan efek.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/sections");
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSections(data.sections || []);
      setLoadingList(false);
    })();
  }, [router]);

  function resetForm() {
    setEditingId(null);
    setPlatform("shopee");
    setName("");
    setNarrativeOrder("0");
    setKbAnalysis("");
    setUsesPeriodComparison(false);
    setMetrics([emptyMetric()]);
    setError("");
    setSuccess("");
  }

  function startEdit(s: SectionRow) {
    setEditingId(s.id);
    setPlatform(s.platform);
    setName(s.name);
    setNarrativeOrder(String(s.narrativeOrder));
    setKbAnalysis(s.kbAnalysis);
    setUsesPeriodComparison(s.usesPeriodComparison);
    setMetrics(s.metrics.length ? s.metrics.map((m) => ({ ...m })) : [emptyMetric()]);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateMetric(index: number, patch: Partial<MetricRow>) {
    setMetrics((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function addMetric() {
    setMetrics((prev) => [...prev, emptyMetric()]);
  }

  function removeMetric(index: number) {
    setMetrics((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit() {
    setError("");
    setSuccess("");
    setSubmitting(true);

    const payload = {
      platform,
      name,
      narrativeOrder,
      kbAnalysis,
      usesPeriodComparison,
      metrics: filledMetrics,
    };

    try {
      const res = await fetch(
        editingId ? `/api/sections/${editingId}` : "/api/sections",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal menyimpan section.");
        setSubmitting(false);
        return;
      }
      setSuccess(
        editingId
          ? `Section "${data.section.name}" tersimpan (${data.section.status}).`
          : `Section "${data.section.name}" dibuat (${data.section.status}).`
      );
      setSubmitting(false);
      resetForm();
      setLoadingList(true);
      loadSections();
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setSubmitting(false);
    }
  }

  async function handleDelete(s: SectionRow) {
    if (!window.confirm(`Hapus section "${s.name}"? Tindakan ini tidak bisa dibatalkan.`)) {
      return;
    }
    setRowError((p) => ({ ...p, [s.id]: "" }));
    const res = await fetch(`/api/sections/${s.id}`, { method: "DELETE" });
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRowError((p) => ({
        ...p,
        [s.id]: data.error || `Gagal menghapus section (kode ${res.status}).`,
      }));
      return;
    }
    if (editingId === s.id) resetForm();
    setLoadingList(true);
    loadSections();
  }

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Kembali ke dashboard
        </button>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Section &amp; KB</h1>
        <p className="mt-1.5 text-sm text-fg-3">
          Atur section per platform beserta metrik yang diharapkan dan analisis KB-nya. Section
          baru jadi <span className="text-ok">aktif</span> hanya kalau lengkap: nama + KB +
          minimal 1 metrik.
        </p>

        <div className="mt-7 grid items-start gap-6 xl:grid-cols-2">
        {/* Form buat / edit */}
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="label-sm">
              {editingId ? "Edit section" : "Tambah section baru"}
            </h2>
            <span
              className={`badge ${
                willBeActive ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
              }`}
            >
              {willBeActive ? "Akan jadi: Aktif" : "Akan jadi: Draft"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-sm mb-1.5 block">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                className="input w-full"
              >
                <option value="shopee">Shopee</option>
                <option value="tiktok">TikTok</option>
              </select>
            </div>
            <div>
              <label className="label-sm mb-1.5 block">
                Narrative order
              </label>
              <input
                type="number"
                value={narrativeOrder}
                onChange={(e) => setNarrativeOrder(e.target.value)}
                className="input w-full"
                placeholder="0"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-sm mb-1.5 block">
                Nama section
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input w-full"
                placeholder="mis. Ringkasan Penjualan"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label-sm mb-1.5 block">
                Analisis KB
              </label>
              <textarea
                value={kbAnalysis}
                onChange={(e) => setKbAnalysis(e.target.value)}
                rows={4}
                className="textarea w-full"
                placeholder="Panduan analisis / narasi untuk section ini…"
              />
            </div>
            <div className="sm:col-span-2">
              {/* Tahap 6b — opt-in perbandingan periode: foto section ini ditandai bulan
                  per-foto saat upload + satu periode utama (lihat DESIGN §Perbandingan Periode). */}
              <label className="flex items-start gap-2.5 rounded-[10px] border border-line bg-ink p-3.5">
                <input
                  type="checkbox"
                  checked={usesPeriodComparison}
                  onChange={(e) => setUsesPeriodComparison(e.target.checked)}
                  className="mt-0.5 accent-[#5E8BFF]"
                />
                <span>
                  <span className="block text-sm text-fg-2">
                    Section ini pakai perbandingan periode
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-3">
                    Saat upload, tiap foto section ini ditandai bulan + tahun, dan satu foto
                    ditandai sebagai periode utama. Sistem menghitung perubahan antar bulan
                    (persen) untuk dinarasikan Analyst.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Editor metrik */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="label-sm">
                Expected metrics
              </label>
              <button
                onClick={addMetric}
                className="text-xs text-accent transition-colors hover:text-accent-hi"
              >
                + Tambah metrik
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {metrics.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 items-center gap-2 rounded-[10px] border border-line bg-ink p-2"
                >
                  <input
                    type="text"
                    value={m.key}
                    onChange={(e) => updateMetric(i, { key: e.target.value })}
                    className="input col-span-3 px-2 py-1.5 text-xs"
                    placeholder="key"
                  />
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => updateMetric(i, { label: e.target.value })}
                    className="input col-span-4 px-2 py-1.5 text-xs"
                    placeholder="Label"
                  />
                  <select
                    value={m.type}
                    onChange={(e) => updateMetric(i, { type: e.target.value as MetricType })}
                    className="select col-span-2 px-2 py-1.5 text-xs"
                  >
                    {METRIC_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="col-span-2 flex items-center gap-1.5 text-xs text-fg-3">
                    <input
                      type="checkbox"
                      checked={m.required}
                      onChange={(e) => updateMetric(i, { required: e.target.checked })}
                      className="accent-[#5E8BFF]"
                    />
                    wajib
                  </label>
                  <button
                    onClick={() => removeMetric(i)}
                    disabled={metrics.length === 1}
                    className="col-span-1 text-fg-3 hover:text-danger disabled:opacity-30"
                    title="Hapus metrik"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {success && <p className="mt-3 text-sm text-ok">{success}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary px-4 py-2.5"
            >
              {submitting ? "Menyimpan…" : editingId ? "Simpan perubahan" : "Buat section"}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="btn-ghost px-4 py-2.5"
              >
                Batal edit
              </button>
            )}
          </div>
        </div>

        {/* Daftar section */}
        <div>
          <h2 className="label-sm">Daftar section</h2>
          {loadingList ? (
            <p className="mt-3 text-sm text-fg-3">Memuat…</p>
          ) : sections.length === 0 ? (
            <p className="mt-3 text-sm text-fg-3">Belum ada section.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {sections.map((s) => (
                <div
                  key={s.id}
                  className="card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="badge border border-line bg-surface-2 text-fg-2">
                          {s.platform === "shopee" ? "Shopee" : "TikTok"}
                        </span>
                        <span className="font-mono text-xs text-fg-3">#{s.narrativeOrder}</span>
                        <span
                          className={`badge ${
                            s.status === "active"
                              ? "bg-ok/15 text-ok"
                              : "bg-warn/15 text-warn"
                          }`}
                        >
                          {s.status === "active" ? "Aktif" : "Draft"}
                        </span>
                        {s.usesPeriodComparison && (
                          <span className="badge bg-accent/15 text-accent-hi">
                            Perbandingan periode
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1.5 truncate text-sm font-medium text-fg">
                        {s.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-fg-3">
                        {s.metrics.length} metrik
                        {s.metrics.length > 0 && (
                          <span className="text-fg-3">
                            {" — "}
                            {s.metrics.map((m) => m.key).join(", ")}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => startEdit(s)}
                        className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className="btn-danger px-3 py-1.5 text-xs"
                      >
                        Hapus
                      </button>
                    </div>
                    {rowError[s.id] && (
                      <p className="mt-2 text-right text-xs text-danger">{rowError[s.id]}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
