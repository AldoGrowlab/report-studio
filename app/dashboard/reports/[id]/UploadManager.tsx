"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { missingPhotoSections, groupBySection, formatValueID } from "@/lib/uploads-view";
import { splitByNumbers } from "@/lib/insight-format";

type SectionOption = {
  id: string;
  name: string;
  platform: "shopee" | "tiktok";
  narrativeOrder: number;
};

type ExtractionStatus = "ok" | "missing" | "low_confidence";

type Extraction = {
  id: string;
  key: string;
  value: number | null;
  rawText: string | null;
  confidence: number;
  status: ExtractionStatus;
  manuallyConfirmed: boolean;
};

type SavedUpload = {
  id: string;
  sectionId: string;
  sectionName: string;
  platform: string;
  imageSrc: string;
  extractions: Extraction[];
};

// Insight Analyst per section (Tahap 6a) — hasil generate tersimpan di tabel Insight.
// points = poin insight (target 6 lunak, atap keras 8); numbers = kosakata angka singkat
// untuk bold deterministik.
type SectionInsight = {
  sectionId: string;
  points: string[];
  numbers: string[];
  kbVersion: number;
  generator: string;
  updatedAt: string;
};

type PendingItem = {
  localId: string;
  file: File;
  previewUrl: string;
  sectionId: string;
  saving: boolean;
  error: string;
};

let localCounter = 0;

export default function UploadManager({
  reportId,
  sections,
  initialUploads,
  initialInsights,
}: {
  reportId: string;
  sections: SectionOption[];
  initialUploads: SavedUpload[];
  initialInsights: SectionInsight[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedUpload[]>(initialUploads);
  const [pending, setPending] = useState<PendingItem[]>([]);

  const multiPlatform = new Set(sections.map((s) => s.platform)).size > 1;
  const sectionLabel = (s: SectionOption) =>
    multiPlatform ? `${s.platform === "shopee" ? "Shopee" : "TikTok"} — ${s.name}` : s.name;
  const sectionName = (id: string) => sections.find((s) => s.id === id)?.name ?? id;

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({
        localId: `p${localCounter++}`,
        file,
        previewUrl: URL.createObjectURL(file),
        sectionId: "",
        saving: false,
        error: "",
      })),
    ]);
    e.target.value = ""; // izinkan pilih file yang sama lagi
  }

  function patchPending(localId: string, patch: Partial<PendingItem>) {
    setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }

  function removePending(localId: string) {
    setPending((prev) => {
      const item = prev.find((p) => p.localId === localId);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  async function savePending(item: PendingItem) {
    if (!item.sectionId) {
      patchPending(item.localId, { error: "Pilih label section dulu." });
      return;
    }
    patchPending(item.localId, { saving: true, error: "" });

    const fd = new FormData();
    fd.append("file", item.file);
    fd.append("sectionId", item.sectionId);

    try {
      const res = await fetch(`/api/reports/${reportId}/uploads`, { method: "POST", body: fd });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        patchPending(item.localId, { saving: false, error: data.error || "Gagal menyimpan." });
        return;
      }
      // Pindah dari pending ke saved
      URL.revokeObjectURL(item.previewUrl);
      setSaved((prev) => [
        ...prev,
        {
          id: data.upload.id,
          sectionId: data.upload.sectionId,
          sectionName: data.upload.section.name,
          platform: data.upload.platform,
          imageSrc: `/api/uploads/${data.upload.id}/image`,
          extractions: [],
        },
      ]);
      setPending((prev) => prev.filter((p) => p.localId !== item.localId));
    } catch {
      patchPending(item.localId, { saving: false, error: "Kesalahan jaringan." });
    }
  }

  async function deleteSaved(u: SavedUpload) {
    if (!window.confirm("Hapus foto ini dari report?")) return;
    const res = await fetch(`/api/uploads/${u.id}`, { method: "DELETE" });
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    if (res.ok) setSaved((prev) => prev.filter((p) => p.id !== u.id));
  }

  // --- Lightbox: lihat foto ukuran penuh untuk cocokkan angka dgn hasil ekstraksi ---
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // --- Ekstraksi angka ---
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [extractError, setExtractError] = useState<Record<string, string>>({});

  async function extractOne(uploadId: string) {
    // Ekstrak ulang MENGGANTI seluruh hasil — termasuk angka yang sudah
    // dikonfirmasi/dikoreksi manual. Minta persetujuan dulu supaya vetting tak hilang diam-diam.
    const target = saved.find((u) => u.id === uploadId);
    if (
      target?.extractions.some((e) => e.manuallyConfirmed) &&
      !window.confirm(
        "Foto ini punya angka yang sudah dikonfirmasi/dikoreksi manual. Ekstrak ulang akan menghapus koreksi itu. Lanjutkan?"
      )
    ) {
      return;
    }
    setExtracting((p) => ({ ...p, [uploadId]: true }));
    setExtractError((p) => ({ ...p, [uploadId]: "" }));
    try {
      const res = await fetch(`/api/uploads/${uploadId}/extract`, { method: "POST" });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setExtractError((p) => ({ ...p, [uploadId]: data.error || "Ekstraksi gagal." }));
        return;
      }
      setSaved((prev) =>
        prev.map((u) => (u.id === uploadId ? { ...u, extractions: data.extractions } : u))
      );
      // Hasil baru -> kembalikan deteksi foto-kosong ke default untuk upload ini.
      setManualFill((p) => ({ ...p, [uploadId]: false }));
    } catch {
      setExtractError((p) => ({ ...p, [uploadId]: "Kesalahan jaringan." }));
    } finally {
      setExtracting((p) => ({ ...p, [uploadId]: false }));
    }
  }

  async function extractAll() {
    for (const u of saved) {
      await extractOne(u.id);
    }
  }

  // --- Konfirmasi & koreksi manual angka (Tahap 5) ---
  // Hasil edit PERSIST ke Extraction via PATCH (sumber kebenaran untuk Analyst),
  // state lokal diperbarui dari baris hasil server — bukan tampilan sementara.
  const [editDraft, setEditDraft] = useState<Record<string, string>>({}); // extractionId -> teks input
  const [editSaving, setEditSaving] = useState<Record<string, boolean>>({});
  const [editError, setEditError] = useState<Record<string, string>>({});
  // Foto kosong (SEMUA metrik missing): tabel disembunyikan, diganti pesan level-foto.
  // true = user memilih "Isi manual" -> tabel tampil supaya tetap bisa Edit.
  const [manualFill, setManualFill] = useState<Record<string, boolean>>({});

  function startEdit(e: Extraction) {
    setEditError((p) => ({ ...p, [e.id]: "" }));
    setEditDraft((p) => ({ ...p, [e.id]: e.value === null ? "" : String(e.value) }));
  }

  function cancelEdit(extractionId: string) {
    setEditDraft((p) => {
      const next = { ...p };
      delete next[extractionId];
      return next;
    });
    setEditError((p) => ({ ...p, [extractionId]: "" }));
  }

  async function patchExtraction(uploadId: string, extractionId: string, value: number | null) {
    setEditSaving((p) => ({ ...p, [extractionId]: true }));
    setEditError((p) => ({ ...p, [extractionId]: "" }));
    try {
      const res = await fetch(`/api/extractions/${extractionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setEditError((p) => ({ ...p, [extractionId]: data.error || "Gagal menyimpan." }));
        return;
      }
      // Ganti baris dari respons server (bukti sudah persist di Extraction).
      setSaved((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? {
                ...u,
                extractions: u.extractions.map((e) =>
                  e.id === extractionId ? { ...e, ...data.extraction } : e
                ),
              }
            : u
        )
      );
      cancelEdit(extractionId);
    } catch {
      setEditError((p) => ({ ...p, [extractionId]: "Kesalahan jaringan." }));
    } finally {
      setEditSaving((p) => ({ ...p, [extractionId]: false }));
    }
  }

  // Simpan hasil ketikan user. Kosong = angka memang tidak ada (null/missing).
  // Terima koma sebagai desimal (kebiasaan lokal); tolak yang bukan angka.
  function saveEdit(uploadId: string, extractionId: string) {
    const raw = (editDraft[extractionId] ?? "").trim();
    if (raw === "") {
      void patchExtraction(uploadId, extractionId, null);
      return;
    }
    const num = Number(raw.replace(",", "."));
    if (!Number.isFinite(num)) {
      setEditError((p) => ({ ...p, [extractionId]: "Masukkan angka yang valid." }));
      return;
    }
    void patchExtraction(uploadId, extractionId, num);
  }

  // Konfirmasi satu-klik untuk baris ragu: nilai tetap, status jadi ok + tanda manual.
  function confirmOne(uploadId: string, e: Extraction) {
    void patchExtraction(uploadId, e.id, e.value);
  }

  // --- Insight Analyst per section (Tahap 6a) ---
  // Generate ulang MENGGANTI insight tersimpan (satu insight per section per report).
  const [insights, setInsights] = useState<Record<string, SectionInsight>>(() =>
    Object.fromEntries(initialInsights.map((i) => [i.sectionId, i]))
  );
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({});
  const [insightError, setInsightError] = useState<Record<string, string>>({});

  async function generateSectionInsight(sectionId: string) {
    setInsightLoading((p) => ({ ...p, [sectionId]: true }));
    setInsightError((p) => ({ ...p, [sectionId]: "" }));
    try {
      const res = await fetch(`/api/reports/${reportId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setInsightError((p) => ({ ...p, [sectionId]: data.error || "Generate insight gagal." }));
        return;
      }
      setInsights((p) => ({ ...p, [sectionId]: data.insight }));
    } catch {
      setInsightError((p) => ({ ...p, [sectionId]: "Kesalahan jaringan." }));
    } finally {
      setInsightLoading((p) => ({ ...p, [sectionId]: false }));
    }
  }

  // --- Unduh PPT (Tahap 8) ---
  // Peringatan ringan sebelum generate: section berfoto yang belum punya insight akan
  // tampil foto saja — memberi tahu, TIDAK menghalangi (report selalu bisa jadi).
  function downloadPptx() {
    const sectionIdsWithPhotos = [...new Set(saved.map((u) => u.sectionId))];
    const noInsight = sectionIdsWithPhotos.filter((id) => !insights[id]);
    if (noInsight.length > 0) {
      const names = noInsight.map((id) => saved.find((u) => u.sectionId === id)?.sectionName ?? id);
      const ok = window.confirm(
        `${noInsight.length} section belum ada insight — akan tampil foto saja:\n\n` +
          names.map((n) => `• ${n}`).join("\n") +
          `\n\nLanjut generate PPT?`
      );
      if (!ok) return;
    }
    window.location.href = `/api/reports/${reportId}/pptx`;
  }

  const statusBadge: Record<ExtractionStatus, string> = {
    ok: "bg-teal-500/15 text-teal-300",
    low_confidence: "bg-amber-500/15 text-amber-300",
    missing: "bg-red-500/15 text-red-400",
  };
  const statusLabel: Record<ExtractionStatus, string> = {
    ok: "ok",
    low_confidence: "ragu",
    missing: "n/a", // label tampilan netral; status DB tetap "missing"
  };

  const noActiveSections = sections.length === 0;

  // (1c) Section aktif yang fotonya belum ada — reaktif terhadap simpan/hapus.
  const missing = missingPhotoSections(
    sections,
    saved.map((u) => u.sectionId)
  );
  // (3) Foto tersimpan dikelompokkan per section; >1 foto = sumber terpisah (#1, #2, …).
  const groups = groupBySection(
    saved,
    sections.map((s) => s.id)
  );

  return (
    <div className="mt-8">
      {/* Area unggah */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-sm font-medium text-neutral-200">Unggah screenshot</h2>
        {noActiveSections ? (
          <p className="mt-2 text-sm text-amber-300">
            Belum ada section aktif untuk platform ini. Buat/aktifkan section dulu di Section &amp; KB
            sebelum melabeli foto.
          </p>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">
            Pilih satu atau beberapa gambar. Tiap foto wajib dilabeli ke satu section sebelum
            disimpan.
          </p>
        )}
        <label className="mt-3 inline-block">
          <span className="cursor-pointer rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800">
            Pilih gambar…
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={onPickFiles}
            disabled={noActiveSections}
            className="hidden"
          />
        </label>
      </div>

      {/* (1c) Pengingat: section aktif yang fotonya belum ada (DESIGN §Alur UX) */}
      {!noActiveSections &&
        (missing.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-xs font-medium text-amber-300">
              {missing.length} section aktif belum ada fotonya — lengkapi sebelum generate:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missing.map((s) => (
                <span
                  key={s.id}
                  className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200"
                >
                  {sectionLabel(s)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          saved.length > 0 && (
            <p className="mt-4 text-xs text-teal-300">
              ✓ Semua section aktif sudah punya foto.
            </p>
          )
        ))}

      {/* Antrian belum disimpan */}
      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Belum disimpan ({pending.length})
          </h3>
          {pending.map((item) => (
            <div
              key={item.localId}
              className="flex gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt="preview"
                onClick={() => setLightbox({ src: item.previewUrl, label: item.file.name })}
                title="Klik untuk lihat ukuran penuh"
                className="h-20 w-20 shrink-0 cursor-zoom-in rounded-lg object-cover transition hover:opacity-80"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-neutral-400">{item.file.name}</p>
                <select
                  value={item.sectionId}
                  onChange={(e) => patchPending(item.localId, { sectionId: e.target.value, error: "" })}
                  className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">— pilih section —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionLabel(s)}
                    </option>
                  ))}
                </select>
                {item.error && <p className="mt-1 text-xs text-red-400">{item.error}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => savePending(item)}
                    disabled={item.saving}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {item.saving ? "Menyimpan…" : "Simpan"}
                  </button>
                  <button
                    onClick={() => removePending(item.localId)}
                    disabled={item.saving}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Buang
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Foto tersimpan + ekstraksi */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-200">
            Foto tersimpan ({saved.length})
          </h3>
          {saved.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={extractAll}
                disabled={Object.values(extracting).some(Boolean)}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                Ekstrak semua
              </button>
              <button
                onClick={downloadPptx}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500"
              >
                Unduh PPT
              </button>
            </div>
          )}
        </div>
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Belum ada foto tersimpan.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groups.map((g) => {
              // Nama section: dari data upload; fallback ke daftar section aktif.
              const groupName = g.items[0]?.sectionName ?? sectionName(g.sectionId);
              return (
                <div key={g.sectionId}>
                  {/* Header grup: satu section, bisa >1 sumber terpisah */}
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      {groupName}
                    </h4>
                    {g.multiSource && (
                      <span
                        title="Tiap foto dinarasikan sebagai sumber terpisah — tidak pernah digabung/dijumlah"
                        className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                      >
                        {g.items.length} sumber terpisah
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-3">
                    {g.items.map((u, srcIdx) => {
                      const cardTitle = g.multiSource ? `Sumber #${srcIdx + 1}` : groupName;
                      const lightboxLabel = g.multiSource
                        ? `${groupName} — Sumber #${srcIdx + 1}`
                        : groupName;
                      return (
              <div key={u.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={u.imageSrc}
                    alt={lightboxLabel}
                    onClick={() => setLightbox({ src: u.imageSrc, label: lightboxLabel })}
                    title="Klik untuk lihat ukuran penuh"
                    className="h-24 w-24 shrink-0 cursor-zoom-in rounded-lg object-cover transition hover:opacity-80"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-neutral-200">
                        {cardTitle}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => extractOne(u.id)}
                          disabled={extracting[u.id]}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          {extracting[u.id]
                            ? "Mengekstrak…"
                            : u.extractions.length
                              ? "Ekstrak ulang"
                              : "Ekstrak angka"}
                        </button>
                        <button
                          onClick={() => deleteSaved(u)}
                          className="text-xs text-neutral-500 hover:text-red-400"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>

                    {extractError[u.id] && (
                      <p className="mt-1 text-xs text-red-400">{extractError[u.id]}</p>
                    )}

                    {u.extractions.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">Belum diekstrak.</p>
                    ) : u.extractions.every((e) => e.status === "missing") &&
                      !manualFill[u.id] ? (
                      // Foto kosong: SEMUA metrik missing -> pesan level-foto, tabel disembunyikan.
                      // Sebagian missing tidak masuk sini (tabel tetap tampil normal).
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-amber-300">
                          Tidak ada angka terbaca — mungkin bukan screenshot yang sesuai.
                        </p>
                        <button
                          onClick={() => setManualFill((p) => ({ ...p, [u.id]: true }))}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800"
                        >
                          Isi manual
                        </button>
                      </div>
                    ) : (
                      <table className="mt-2 w-full text-xs">
                        <thead className="text-neutral-500">
                          <tr>
                            <th className="py-1 text-left font-medium">Metrik</th>
                            <th className="py-1 text-left font-medium">Value</th>
                            <th className="py-1 text-left font-medium">Raw</th>
                            <th className="py-1 text-right font-medium">Conf</th>
                            <th className="py-1 text-right font-medium">Status</th>
                            <th className="py-1 text-right font-medium">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {u.extractions.map((e) => {
                            const isEditing = e.id in editDraft;
                            return (
                              <tr key={e.id} className="border-t border-neutral-800 align-top">
                                <td className="py-1 pr-2 text-neutral-300">{e.key}</td>
                                <td className="py-1 pr-2 text-neutral-100">
                                  {isEditing ? (
                                    <div>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editDraft[e.id]}
                                        onChange={(ev) =>
                                          setEditDraft((p) => ({ ...p, [e.id]: ev.target.value }))
                                        }
                                        onKeyDown={(ev) => {
                                          if (ev.key === "Enter") saveEdit(u.id, e.id);
                                          if (ev.key === "Escape") cancelEdit(e.id);
                                        }}
                                        autoFocus
                                        placeholder="kosong = tidak ada"
                                        className="w-28 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs outline-none focus:border-blue-500"
                                      />
                                      {editError[e.id] && (
                                        <p className="mt-0.5 text-[10px] text-red-400">
                                          {editError[e.id]}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    // Mode baca saja: pemisah ribuan id-ID, murni kosmetik.
                                    // Input Edit diisi dari String(e.value) di startEdit, bukan dari teks ini.
                                    formatValueID(e.value)
                                  )}
                                </td>
                                <td className="py-1 pr-2 text-neutral-500 truncate max-w-[10rem]">
                                  {e.rawText ?? "—"}
                                </td>
                                <td className="py-1 pr-2 text-right text-neutral-400">
                                  {e.status === "missing" ? "—" : e.confidence.toFixed(2)}
                                </td>
                                <td className="py-1 text-right">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadge[e.status]}`}
                                  >
                                    {statusLabel[e.status]}
                                  </span>
                                  {e.manuallyConfirmed && (
                                    <span
                                      title="Sudah dikonfirmasi/dikoreksi manual"
                                      className="ml-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                                    >
                                      ✓ manual
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 pl-2 text-right whitespace-nowrap">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={() => saveEdit(u.id, e.id)}
                                        disabled={editSaving[e.id]}
                                        className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                                      >
                                        {editSaving[e.id] ? "…" : "Simpan"}
                                      </button>
                                      <button
                                        onClick={() => cancelEdit(e.id)}
                                        disabled={editSaving[e.id]}
                                        className="ml-1 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                                      >
                                        Batal
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {e.status === "low_confidence" && !e.manuallyConfirmed && (
                                        <button
                                          onClick={() => confirmOne(u.id, e)}
                                          disabled={editSaving[e.id]}
                                          title="Nilai sudah benar — tandai terkonfirmasi"
                                          className="rounded bg-teal-600/80 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                                        >
                                          Konfirmasi
                                        </button>
                                      )}
                                      <button
                                        onClick={() => startEdit(e)}
                                        disabled={editSaving[e.id]}
                                        className="ml-1 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                                      >
                                        Edit
                                      </button>
                                      {editError[e.id] && (
                                        <p className="mt-0.5 text-[10px] text-red-400">
                                          {editError[e.id]}
                                        </p>
                                      )}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
                      );
                    })}
                  </div>

                  {/* Insight Analyst section ini (Tahap 6a) — insight saja, tanpa caption */}
                  {(() => {
                    const insight = insights[g.sectionId];
                    return (
                      <div className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-neutral-400">Insight</span>
                          <button
                            onClick={() => generateSectionInsight(g.sectionId)}
                            disabled={insightLoading[g.sectionId]}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                          >
                            {insightLoading[g.sectionId]
                              ? "Menganalisa…"
                              : insight
                                ? "Generate ulang"
                                : "Generate insight"}
                          </button>
                        </div>
                        {insightError[g.sectionId] && (
                          <p className="mt-1 text-xs text-red-400">{insightError[g.sectionId]}</p>
                        )}
                        {insight ? (
                          <>
                            <ul className="mt-2 space-y-1.5 text-sm text-neutral-200">
                              {insight.points.map((point, pi) => (
                                <li key={pi} className="flex gap-2">
                                  <span className="text-neutral-500">•</span>
                                  <span>
                                    {/* Bold angka metrik: splitter deterministik yang sama
                                        dengan renderer PPT (lib/insight-format.ts). */}
                                    {splitByNumbers(point, insight.numbers).map((seg, si) =>
                                      seg.bold ? (
                                        <strong key={si} className="font-semibold text-white">
                                          {seg.text}
                                        </strong>
                                      ) : (
                                        <span key={si}>{seg.text}</span>
                                      )
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[10px] text-neutral-500">
                              KB v{insight.kbVersion}
                              {insight.generator === "stub" && " · stub dev"} ·{" "}
                              {new Date(insight.updatedAt).toLocaleString("id-ID")}
                            </p>
                          </>
                        ) : (
                          !insightError[g.sectionId] && (
                            <p className="mt-2 text-xs text-neutral-500">
                              Belum ada insight. Ekstrak angka semua foto section ini dulu, lalu
                              generate.
                            </p>
                          )
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox foto ukuran penuh */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-2 flex w-full max-w-5xl items-center justify-between">
            <span className="truncate text-sm text-neutral-300">{lightbox.label}</span>
            <button
              onClick={() => setLightbox(null)}
              className="rounded-lg border border-neutral-600 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              Tutup ✕
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.src}
            alt={lightbox.label}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-5xl rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
