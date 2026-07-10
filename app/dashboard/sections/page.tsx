"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Platform = "shopee" | "tiktok";
type MetricType = "number" | "currency" | "percent" | "ratio";

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
    const data = await res.json();
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
      const data = await res.json();
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
      const data = await res.json();
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
    const res = await fetch(`/api/sections/${s.id}`, { method: "DELETE" });
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    if (editingId === s.id) resetForm();
    setLoadingList(true);
    loadSections();
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Kembali ke dashboard
        </button>

        <h1 className="mt-4 text-2xl font-semibold">Section &amp; KB</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Atur section per platform beserta metrik yang diharapkan dan analisis KB-nya. Section
          baru jadi <span className="text-teal-300">aktif</span> hanya kalau lengkap: nama + KB +
          minimal 1 metrik.
        </p>

        {/* Form buat / edit */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200">
              {editingId ? "Edit section" : "Tambah section baru"}
            </h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                willBeActive ? "bg-teal-500/15 text-teal-300" : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {willBeActive ? "Akan jadi: Aktif" : "Akan jadi: Draft"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="shopee">Shopee</option>
                <option value="tiktok">TikTok</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                Narrative order
              </label>
              <input
                type="number"
                value={narrativeOrder}
                onChange={(e) => setNarrativeOrder(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="0"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                Nama section
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="mis. Ringkasan Penjualan"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                Analisis KB
              </label>
              <textarea
                value={kbAnalysis}
                onChange={(e) => setKbAnalysis(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="Panduan analisis / narasi untuk section ini…"
              />
            </div>
            <div className="sm:col-span-2">
              {/* Tahap 6b — opt-in perbandingan periode: foto section ini ditandai bulan
                  per-foto saat upload + satu periode utama (lihat DESIGN §Perbandingan Periode). */}
              <label className="flex items-start gap-2.5 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                <input
                  type="checkbox"
                  checked={usesPeriodComparison}
                  onChange={(e) => setUsesPeriodComparison(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                />
                <span>
                  <span className="block text-sm text-neutral-200">
                    Section ini pakai perbandingan periode
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
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
              <label className="block text-xs font-medium text-neutral-400">
                Expected metrics
              </label>
              <button
                onClick={addMetric}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Tambah metrik
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {metrics.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                >
                  <input
                    type="text"
                    value={m.key}
                    onChange={(e) => updateMetric(i, { key: e.target.value })}
                    className="col-span-3 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                    placeholder="key"
                  />
                  <input
                    type="text"
                    value={m.label}
                    onChange={(e) => updateMetric(i, { label: e.target.value })}
                    className="col-span-4 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                    placeholder="Label"
                  />
                  <select
                    value={m.type}
                    onChange={(e) => updateMetric(i, { type: e.target.value as MetricType })}
                    className="col-span-2 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
                  >
                    {METRIC_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="col-span-2 flex items-center gap-1.5 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={m.required}
                      onChange={(e) => updateMetric(i, { required: e.target.checked })}
                      className="accent-blue-600"
                    />
                    wajib
                  </label>
                  <button
                    onClick={() => removeMetric(i)}
                    disabled={metrics.length === 1}
                    className="col-span-1 text-neutral-500 hover:text-red-400 disabled:opacity-30"
                    title="Hapus metrik"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          {success && <p className="mt-3 text-sm text-teal-400">{success}</p>}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? "Menyimpan…" : editingId ? "Simpan perubahan" : "Buat section"}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Batal edit
              </button>
            )}
          </div>
        </div>

        {/* Daftar section */}
        <div className="mt-6">
          <h2 className="text-sm font-medium text-neutral-200">Daftar section</h2>
          {loadingList ? (
            <p className="mt-3 text-sm text-neutral-500">Memuat…</p>
          ) : sections.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">Belum ada section.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {sections.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
                          {s.platform === "shopee" ? "Shopee" : "TikTok"}
                        </span>
                        <span className="text-xs text-neutral-500">#{s.narrativeOrder}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            s.status === "active"
                              ? "bg-teal-500/15 text-teal-300"
                              : "bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {s.status === "active" ? "Aktif" : "Draft"}
                        </span>
                        {s.usesPeriodComparison && (
                          <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                            Perbandingan periode
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1.5 truncate text-sm font-medium text-neutral-100">
                        {s.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {s.metrics.length} metrik
                        {s.metrics.length > 0 && (
                          <span className="text-neutral-600">
                            {" — "}
                            {s.metrics.map((m) => m.key).join(", ")}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => startEdit(s)}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
