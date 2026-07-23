"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { missingPhotoSections, groupBySection, formatValueID } from "@/lib/uploads-view";
import { formatDurationID, parseDurationToSeconds } from "@/lib/duration";
import { MAX_TEXT_LENGTH } from "@/lib/text-metric";
import { ANALYSIS_MAX_PX } from "@/lib/merge-suggest";
import { matchSubGroup } from "@/lib/subgroups";
import { parsePointLine, splitByNumbers } from "@/lib/insight-format";
import { formatMonthID } from "@/lib/period";
import { periodMonthOptions, isPrimaryMonth, matchMonthToPair } from "@/lib/report-period";
import { MAX_UPLOAD_BYTES } from "@/lib/reports";
import MergePhotosModal from "./MergePhotosModal";

type SubGroupOption = { key: string; label: string; aliases: string[] };

type SectionOption = {
  id: string;
  name: string;
  platform: "shopee" | "tiktok";
  narrativeOrder: number;
  // Tahap 6b — section ini pakai perbandingan periode: foto ditandai bulan + satu utama.
  usesPeriodComparison: boolean;
  // Fase 1 — section terdiri dari beberapa tool berfoto terpisah (Flash Sale/Diskon/…).
  // Kosong = section biasa; dropdown sub-grup tidak muncul sama sekali.
  subGroups: SubGroupOption[];
};

type ExtractionStatus = "ok" | "missing" | "low_confidence";

type MetricType = "number" | "currency" | "percent" | "ratio" | "duration" | "text";

type Extraction = {
  id: string;
  key: string;
  value: number | null;
  rawText: string | null;
  confidence: number;
  status: ExtractionStatus;
  manuallyConfirmed: boolean;
  // Tipe metrik section-nya — menentukan cara nilai ditampilkan & diedit.
  // Durasi disimpan DETIK, tapi ditampilkan/diketik sebagai "1j 23mnt 45dtk" / "01:23:45".
  // Teks (nama produk/affiliator) nilainya ada di rawText, value selalu null.
  type: MetricType;
};

type SavedUpload = {
  id: string;
  sectionId: string;
  sectionName: string;
  platform: string;
  imageSrc: string;
  // Tahap 6b — hanya terisi untuk section ber-perbandingan-periode. Status "periode utama"
  // TIDAK disimpan lagi per foto (Poin 2) — diturunkan dari pasangan report.
  periodMonth: string | null;
  subGroupKey: string;
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
  // Audit P2 — true kalau data (foto/angka) berubah SETELAH insight ini dibuat.
  stale?: boolean;
};

// Kesimpulan Validator per platform (Tahap 7a) — tersimpan di tabel Conclusion.
// Mekanisme bold sama dengan insight: numbers = union kosakata insight platform itu.
type PlatformConclusion = {
  platform: "shopee" | "tiktok";
  points: string[];
  numbers: string[];
  generator: string;
  updatedAt: string;
  // Audit P3 — true kalau insight se-platform berubah SETELAH kesimpulan ini dibuat.
  stale?: boolean;
};

// "Rekomendasi & Action Plan" per platform (Fase A gaya agency) — DIKETIK USER MANUAL,
// bukan AI. Poin demi poin; tanpa poin = slide rekomendasi dilewati saat generate PPT.
type PlatformRecommendation = {
  platform: "shopee" | "tiktok";
  points: string[];
};

// Jejak revisi Validator (Tahap 7b): before/after/alasan — tidak ada perubahan diam-diam.
// resolved=false = cek ulang masih menemukan masalah (ter-escalate, ada flag).
type InsightRevisionView = {
  id: string;
  sectionId: string;
  pointsBefore: string[];
  pointsAfter: string[];
  reason: string;
  resolved: boolean;
  createdAt: string;
};

// Flag yang WAJIB terlihat di halaman report (bukan terkubur di log):
// - "inkonsistensi" (Tahap 7b) hasil escalate Validator, severity info;
// - "periode" (Jul 2026) screenshot yang bulannya berbeda dari bulan report,
//   severity tinggi — menyentuh presisi angka. Ditulis saat ekstraksi, bukan saat
//   membuat kesimpulan, jadi umurnya mengikuti ekstraksi terakhir foto itu.
type FlagView = {
  id: string;
  platform: "shopee" | "tiktok";
  section: string;
  note: string;
  type: string;
  severity: "info" | "tinggi";
  createdAt: string;
};

type PendingItem = {
  localId: string;
  file: File;
  previewUrl: string;
  sectionId: string;
  // Tahap 6b — dipakai hanya saat section terpilih ber-perbandingan-periode.
  periodMonth: string;
  saving: boolean;
  error: string;
  // Deteksi Bulan Otomatis (Jul 2026) — jalur pengisi label, jalan saat foto DIPILIH.
  // periodTouched = operator sudah memilih sendiri; deteksi TIDAK PERNAH menimpanya,
  // termasuk kalau hasilnya baru datang belakangan. periodMismatch = bulan foto terbaca
  // di LUAR pasangan report (Poin 2) — peringatan salah bulan, label dibiarkan kosong.
  periodDetecting: boolean;
  periodDetected: boolean;
  periodTouched: boolean;
  periodMismatch: string | null;
  // Fase 1 — sub-grup foto. tabLabel disimpan APA ADANYA dari pembaca konteks; pencocokan
  // ke sub-grup baru bisa dilakukan setelah section dipilih (KB-nya milik section).
  tabLabel: string | null;
  subGroupKey: string;
  subGroupDetected: boolean;
  subGroupTouched: boolean;
};

// Daftar poin dengan sub-poin SATU tingkat (Fase C — prefix tab di storage) + bold angka
// deterministik. Dipakai panel insight, kesimpulan, dan before/after revisi agar seragam
// dengan renderer PPT (parsePointLine + splitByNumbers yang sama).
function BoldPoints({
  points,
  numbers,
  small = false,
}: {
  points: string[];
  numbers: string[];
  small?: boolean;
}) {
  return (
    <ul
      className={
        small
          ? "mt-1 space-y-1 text-xs text-fg-2"
          : "mt-2 space-y-1.5 text-sm text-fg-2"
      }
    >
      {points.map((line, pi) => {
        const { depth, text } = parsePointLine(line);
        return (
          <li
            key={pi}
            className={`flex ${small ? "gap-1.5" : "gap-2"} ${
              depth === 1 ? (small ? "pl-4" : "pl-6") : ""
            }`}
          >
            <span className="text-fg-3">{depth === 1 ? "–" : "•"}</span>
            <span>
              {splitByNumbers(text, numbers).map((seg, si) =>
                seg.bold ? (
                  <strong key={si} className="font-semibold text-fg">
                    {seg.text}
                  </strong>
                ) : (
                  <span key={si}>{seg.text}</span>
                )
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

let localCounter = 0;

export default function UploadManager({
  reportId,
  platforms,
  periodeUtama,
  periodePembanding,
  sections,
  initialUploads,
  initialInsights,
  initialConclusions,
  initialRecommendations,
  initialRevisions,
  initialFlags,
}: {
  reportId: string;
  platforms: ("shopee" | "tiktok")[];
  // Poin 2 — pasangan bulan level report. Bulan foto hanya boleh salah satu dari ini,
  // dan status "periode utama" foto = turunan (bulanFoto == periodeUtama).
  periodeUtama: string | null;
  periodePembanding: string | null;
  sections: SectionOption[];
  initialUploads: SavedUpload[];
  initialInsights: SectionInsight[];
  initialConclusions: PlatformConclusion[];
  initialRecommendations: PlatformRecommendation[];
  initialRevisions: InsightRevisionView[];
  initialFlags: FlagView[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedUpload[]>(initialUploads);
  const [pending, setPending] = useState<PendingItem[]>([]);

  const multiPlatform = new Set(sections.map((s) => s.platform)).size > 1;
  const sectionLabel = (s: SectionOption) =>
    multiPlatform ? `${s.platform === "shopee" ? "Shopee" : "TikTok"} — ${s.name}` : s.name;
  const sectionName = (id: string) => sections.find((s) => s.id === id)?.name ?? id;
  const sectionUsesComparison = (id: string) =>
    sections.find((s) => s.id === id)?.usesPeriodComparison ?? false;
  const sectionSubGroups = (id: string): SubGroupOption[] =>
    sections.find((s) => s.id === id)?.subGroups ?? [];
  const subGroupLabel = (sectionId: string, key: string) =>
    sectionSubGroups(sectionId).find((g) => g.key === key)?.label ?? key;
  // Poin 2 — bulan foto hanya boleh salah satu dari pasangan report (2 opsi; 1 bila tanpa
  // pembanding). Menggantikan daftar 13 bulan bebas.
  const pair = { periodeUtama, periodePembanding };
  const monthOpts = periodMonthOptions(pair).map((value) => ({ value, label: formatMonthID(value) }));
  const isPrimary = (periodMonth: string | null) => isPrimaryMonth(pair, periodMonth);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const added = files.map((file) => ({
      localId: `p${localCounter++}`,
      file,
      previewUrl: URL.createObjectURL(file),
      sectionId: "",
      periodMonth: "",
      saving: false,
      periodDetecting: false,
      periodDetected: false,
      periodTouched: false,
      periodMismatch: null,
      tabLabel: null,
      subGroupKey: "",
      subGroupDetected: false,
      subGroupTouched: false,
      error:
        file.size > MAX_UPLOAD_BYTES
          ? `Ukuran ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas 10 MB.`
          : file.size === 0
            ? "File kosong."
            : "",
    }));
    setPending((prev) => [...prev, ...added]);
    e.target.value = ""; // izinkan pilih file yang sama lagi
    // Deteksi periode tiap foto PARALEL — masing-masing mengisi labelnya sendiri.
    for (const item of added) {
      if (item.error === "") void detectPeriodFor(item.localId, item.file);
    }
  }

  // Kecilkan file jadi base64 untuk analisis (pola sama dengan Auto-potong): yang dibaca
  // cuma satu label periode, bukan angka — 1200px sudah lebih dari cukup dan payload kecil.
  async function fileToAnalysisBase64(file: File): Promise<string | null> {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url;
      });
      if (!img) return null;
      const k = Math.min(1, ANALYSIS_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Gagal / tak terbaca = DIAM (silent fallback): dropdown tetap "— bulan foto ini —" dan
  // operator memilih manual. Fitur bantu tidak boleh memunculkan error yang mengganggu.
  async function detectPeriodFor(localId: string, file: File) {
    patchPending(localId, { periodDetecting: true });
    try {
      const photo = await fileToAnalysisBase64(file);
      if (!photo) return;
      const res = await fetch("/api/period-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const month = typeof data.month === "string" ? data.month : null;
      const tabLabel = typeof data.tabLabel === "string" ? data.tabLabel : null;
      // Poin 2 — deteksi jadi PENCOCOK ke pasangan report: bulan terbaca dipetakan ke
      // periode utama / pembanding. Bulan di LUAR pasangan -> label DIBIARKAN kosong +
      // peringatan salah-bulan (bukan diisi diam-diam). Pilihan manual tetap MENANG.
      const match = matchMonthToPair(pair, month);
      setPending((prev) =>
        prev.map((p) => {
          if (p.localId !== localId) return p;
          const next = { ...p, tabLabel };
          if (month && (match === "utama" || match === "pembanding")) {
            if (!p.periodTouched && p.periodMonth === "") {
              next.periodMonth = month;
              next.periodDetected = true;
            }
            next.periodMismatch = null;
          } else if (month && match === "lain") {
            // Terbaca, tapi di luar periode report -> jangan isi, peringatkan.
            next.periodMismatch = `Foto terbaca ${formatMonthID(month)}, di luar periode report (${monthOpts
              .map((m) => m.label)
              .join(" / ")}).`;
          }
          // Sub-grup baru bisa dicocokkan kalau section-nya sudah dipilih — daftar
          // sub-grup milik section, bukan milik foto. Kalau belum, tabLabel disimpan dan
          // pencocokannya menyusul saat operator memilih section (lihat pickSectionFor).
          const matched = matchSubGroup(tabLabel, sectionSubGroups(p.sectionId));
          if (matched && !p.subGroupTouched && p.subGroupKey === "") {
            next.subGroupKey = matched;
            next.subGroupDetected = true;
          }
          return next;
        })
      );
    } catch {
      /* diam — operator memilih bulan manual */
    } finally {
      patchPending(localId, { periodDetecting: false });
    }
  }

  // Gabung Foto (Jul 2026) — hasil gabungan masuk ke antrean yang SAMA dengan foto biasa,
  // hanya saja label section-nya sudah terisi dari modal. Bulan & periode utama tetap
  // dipilih di baris antrean seperti foto tunggal; server tidak tahu bedanya sama sekali.
  const [mergeOpen, setMergeOpen] = useState(false);

  function onMerged(file: File, sectionId: string, mergedSubGroupKey?: string) {
    const localId = `p${localCounter++}`;
    setPending((prev) => [
      ...prev,
      {
        localId,
        file,
        previewUrl: URL.createObjectURL(file),
        sectionId,
        periodMonth: "",
        saving: false,
        periodDetecting: false,
        periodDetected: false,
        periodTouched: false,
        periodMismatch: null,
        tabLabel: null,
        // Hasil Gabung Foto mewarisi label sub-grup sumbernya (aturan 1c) — modal yang
        // menentukan, karena ia yang tahu foto-foto asalnya.
        subGroupKey: mergedSubGroupKey ?? "",
        subGroupDetected: false,
        subGroupTouched: Boolean(mergedSubGroupKey),
        error:
          file.size > MAX_UPLOAD_BYTES
            ? `Ukuran ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas 10 MB.`
            : "",
      },
    ]);
    setMergeOpen(false);
    // Hasil gabungan juga dideteksi periodenya — sumbernya tetap screenshot asli.
    if (file.size <= MAX_UPLOAD_BYTES) void detectPeriodFor(localId, file);
  }

  function patchPending(localId: string, patch: Partial<PendingItem>) {
    setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }

  // Section baru dipilih SETELAH foto masuk antrean, jadi pencocokan teks tab -> sub-grup
  // dijalankan di sini juga (deteksi bisa selesai lebih dulu maupun belakangan).
  function pickSectionFor(localId: string, sectionId: string) {
    setPending((prev) =>
      prev.map((p) => {
        if (p.localId !== localId) return p;
        const matched = matchSubGroup(p.tabLabel, sectionSubGroups(sectionId));
        return {
          ...p,
          sectionId,
          error: "",
          // Ganti section = daftar sub-grup berganti; pilihan lama tak lagi berlaku.
          subGroupKey: matched ?? "",
          subGroupDetected: matched !== null,
          subGroupTouched: false,
        };
      })
    );
  }

  function removePending(localId: string) {
    setPending((prev) => {
      const item = prev.find((p) => p.localId === localId);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  async function savePending(item: PendingItem) {
    if (item.file.size > MAX_UPLOAD_BYTES || item.file.size === 0) return;
    if (!item.sectionId) {
      patchPending(item.localId, { error: "Pilih label section dulu." });
      return;
    }
    const groups = sectionSubGroups(item.sectionId);
    if (groups.length > 0 && !item.subGroupKey) {
      patchPending(item.localId, {
        error: `Section ini punya sub-grup (${groups.map((g) => g.label).join(", ")}) — pilih dulu sub-grup foto ini.`,
      });
      return;
    }
    const usesComparison = sectionUsesComparison(item.sectionId);
    if (usesComparison && !item.periodMonth) {
      patchPending(item.localId, {
        error: "Section ini pakai perbandingan periode — pilih bulan foto ini dulu.",
      });
      return;
    }
    patchPending(item.localId, { saving: true, error: "" });

    const fd = new FormData();
    fd.append("file", item.file);
    fd.append("sectionId", item.sectionId);
    if (sectionSubGroups(item.sectionId).length > 0) {
      fd.append("subGroupKey", item.subGroupKey);
    }
    if (usesComparison) {
      fd.append("periodMonth", item.periodMonth);
    }

    try {
      const res = await fetch(`/api/reports/${reportId}/uploads`, { method: "POST", body: fd });
      if (res.status === 403) {
        patchPending(item.localId, { saving: false });
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchPending(item.localId, { saving: false, error: data.error || `Gagal menyimpan (kode ${res.status}).` });
        return;
      }
      // Pindah dari pending ke saved. Status "periode utama" tak lagi disimpan/di-unset —
      // ia turunan dari pasangan report, jadi tak ada foto lain yang perlu disentuh.
      URL.revokeObjectURL(item.previewUrl);
      setSaved((prev) => [
        ...prev,
        {
          id: data.upload.id,
          sectionId: data.upload.sectionId,
          sectionName: data.upload.section.name,
          platform: data.upload.platform,
          imageSrc: `/api/uploads/${data.upload.id}/image`,
          periodMonth: data.upload.periodMonth ?? null,
          subGroupKey: data.upload.subGroupKey ?? "_default",
          extractions: [],
        },
      ]);
      markStale(data.upload.sectionId, data.upload.platform);
      setPending((prev) => prev.filter((p) => p.localId !== item.localId));
    } catch {
      patchPending(item.localId, { saving: false, error: "Kesalahan jaringan." });
    }
  }

  // Poin 2 — ubah BULAN foto tersimpan (hanya ke salah satu pasangan report). Status utama
  // tak lagi diubah per foto (turunan), jadi tombol "Jadikan utama" dihapus.
  async function patchSavedPeriod(u: SavedUpload, periodMonth: string) {
    setRowBusy((p) => ({ ...p, [u.id]: true }));
    setRowError((p) => ({ ...p, [u.id]: "" }));
    let res: Response;
    let data: { upload?: { periodMonth?: string | null } } = {};
    try {
      res = await fetch(`/api/uploads/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodMonth }),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setRowError((p) => ({ ...p, [u.id]: "Kesalahan jaringan — perubahan belum tersimpan." }));
      setRowBusy((p) => ({ ...p, [u.id]: false }));
      return;
    }
    setRowBusy((p) => ({ ...p, [u.id]: false }));
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      const err = (data as { error?: string }).error;
      setRowError((p) => ({
        ...p,
        [u.id]: err || `Gagal mengubah bulan foto (kode ${res.status}).`,
      }));
      return;
    }
    setSaved((prev) =>
      prev.map((s) =>
        s.id === u.id ? { ...s, periodMonth: data.upload?.periodMonth ?? s.periodMonth } : s
      )
    );
    markStale(u.sectionId, u.platform);
  }

  // Dulu: tanpa cabang else, tanpa try/catch, tanpa guard. Kalau server balas 500, layar
  // TIDAK berubah sama sekali dan user tidak punya cara tahu apakah tombolnya rusak atau
  // servernya bermasalah — ia menekan Hapus berkali-kali tanpa hasil.
  async function deleteSaved(u: SavedUpload) {
    if (!window.confirm("Hapus foto ini dari report?")) return;
    setRowBusy((p) => ({ ...p, [u.id]: true }));
    setRowError((p) => ({ ...p, [u.id]: "" }));
    try {
      const res = await fetch(`/api/uploads/${u.id}`, { method: "DELETE" });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError((p) => ({
          ...p,
          [u.id]: data.error || `Gagal menghapus foto (kode ${res.status}).`,
        }));
        return;
      }
      setSaved((prev) => prev.filter((p) => p.id !== u.id));
      markStale(u.sectionId, u.platform);
    } catch {
      setRowError((p) => ({ ...p, [u.id]: "Kesalahan jaringan — foto belum terhapus." }));
    } finally {
      setRowBusy((p) => ({ ...p, [u.id]: false }));
    }
  }

  // Cabut object URL pratinjau saat komponen dilepas. Tanpa ini, user yang memilih 20
  // foto lalu berpindah halaman meninggalkan 20 blob tertahan di memori tab sampai
  // reload penuh. Pakai ref supaya efeknya tidak jalan ulang tiap `pending` berubah.
  const pendingRef = useRef<PendingItem[]>([]);
  // Ref disinkronkan DI DALAM efek, bukan saat render (menulis ref saat render melanggar
  // aturan React dan bisa membuat komponen tidak ter-update seperti seharusnya).
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  // --- Lightbox: lihat foto ukuran penuh untuk cocokkan angka dgn hasil ekstraksi ---
  // Status per foto tersimpan (hapus / ubah periode): mencegah klik ganda dan memberi
  // pesan yang bisa dilihat user, bukan kegagalan senyap.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

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

  async function extractOne(uploadId: string): Promise<"ok" | "failed" | "unauthorized"> {
    // Ekstrak ulang MENGGANTI seluruh hasil — termasuk angka yang sudah
    // dikonfirmasi/dikoreksi manual. Minta persetujuan dulu supaya vetting tak hilang diam-diam.
    const target = saved.find((u) => u.id === uploadId);
    if (
      target?.extractions.some((e) => e.manuallyConfirmed) &&
      !window.confirm(
        "Foto ini punya angka yang sudah dikonfirmasi/dikoreksi manual. Ekstrak ulang akan menghapus koreksi itu. Lanjutkan?"
      )
    ) {
      return "failed";
    }
    setExtracting((p) => ({ ...p, [uploadId]: true }));
    setExtractError((p) => ({ ...p, [uploadId]: "" }));
    try {
      const res = await fetch(`/api/uploads/${uploadId}/extract`, { method: "POST" });
      if (res.status === 403) {
        router.push("/login");
        return "unauthorized";
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExtractError((p) => ({ ...p, [uploadId]: data.error || `Ekstraksi gagal (kode ${res.status}).` }));
        return "failed";
      }
      setSaved((prev) =>
        prev.map((u) => (u.id === uploadId ? { ...u, extractions: data.extractions } : u))
      );
      // Hasil baru -> kembalikan deteksi foto-kosong ke default untuk upload ini.
      setManualFill((p) => ({ ...p, [uploadId]: false }));
      // Deteksi Bulan Otomatis (Jul 2026): bulan report bisa baru terisi, atau muncul
      // flag salah-bulan. Keduanya dirender dari data server — muat ulang supaya
      // badge periode & panel flag langsung sesuai, tanpa menduplikasi logikanya di sini.
      if (data.periodMismatch || data.periodDetected) router.refresh();
      const up = saved.find((u) => u.id === uploadId);
      if (up) markStale(up.sectionId, up.platform);
      return "ok";
    } catch {
      setExtractError((p) => ({ ...p, [uploadId]: "Kesalahan jaringan." }));
      return "failed";
    } finally {
      setExtracting((p) => ({ ...p, [uploadId]: false }));
    }
  }

  // Berhenti begitu sesi habis (dulu loop tetap menembak sisa foto yang semuanya akan
  // 403 selagi navigasi ke /login berjalan), dan laporkan ringkasan agar user tak perlu
  // menggulir seluruh daftar mencari mana yang gagal.
  const [extractSummary, setExtractSummary] = useState("");
  async function extractAll() {
    setExtractSummary("");
    let ok = 0;
    let failed = 0;
    for (const u of saved) {
      const res = await extractOne(u.id);
      if (res === "unauthorized") return; // sesi habis — jangan lanjutkan
      if (res === "ok") ok++;
      else failed++;
    }
    setExtractSummary(
      failed === 0 ? `${ok} foto berhasil diekstrak.` : `${ok} berhasil, ${failed} gagal.`
    );
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
    // Teks: nilainya di rawText. Durasi diisi bentuk manusiawi ("1j 23mnt", bukan 5025).
    const draft =
      e.type === "text"
        ? (e.rawText ?? "")
        : e.value === null
          ? ""
          : e.type === "duration"
            ? formatDurationID(e.value)
            : String(e.value);
    setEditDraft((p) => ({ ...p, [e.id]: draft }));
  }

  function cancelEdit(extractionId: string) {
    setEditDraft((p) => {
      const next = { ...p };
      delete next[extractionId];
      return next;
    });
    setEditError((p) => ({ ...p, [extractionId]: "" }));
  }

  // Body berbeda menurut tipe metrik: { value } untuk angka, { rawText } untuk teks.
  // Server tetap yang memutuskan mana yang dipakai berdasar tipe metrik sebenarnya.
  async function patchExtraction(
    uploadId: string,
    extractionId: string,
    payload: { value: number | null } | { rawText: string | null }
  ) {
    setEditSaving((p) => ({ ...p, [extractionId]: true }));
    setEditError((p) => ({ ...p, [extractionId]: "" }));
    try {
      const res = await fetch(`/api/extractions/${extractionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError((p) => ({ ...p, [extractionId]: data.error || `Gagal menyimpan (kode ${res.status}).` }));
        return;
      }
      // Angka berubah -> insight & kesimpulan yang memakainya jadi basi.
      const edited = saved.find((u) => u.id === uploadId);
      if (edited) markStale(edited.sectionId, edited.platform);
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
  // Metrik DURASI diketik manusiawi ("1j 23mnt", "01:23:45", "45 s") lalu dikonversi ke
  // DETIK di sini — server tetap hanya menerima angka (satuan kanonik).
  function saveEdit(uploadId: string, e: Extraction) {
    const raw = (editDraft[e.id] ?? "").trim();
    // Metrik TEKS: dikirim apa adanya (server yang membersihkan elipsis akhir & membatasi
    // panjang, aturan SAMA dengan Extractor). Kosong = teksnya memang tidak ada.
    if (e.type === "text") {
      if (raw.length > MAX_TEXT_LENGTH) {
        setEditError((p) => ({
          ...p,
          [e.id]: `Teks maksimal ${MAX_TEXT_LENGTH} karakter.`,
        }));
        return;
      }
      void patchExtraction(uploadId, e.id, { rawText: raw === "" ? null : raw });
      return;
    }
    if (raw === "") {
      void patchExtraction(uploadId, e.id, { value: null });
      return;
    }
    if (e.type === "duration") {
      const seconds = parseDurationToSeconds(raw);
      if (seconds === null) {
        setEditError((p) => ({
          ...p,
          [e.id]: "Format durasi tidak terbaca. Contoh: 01:23:45, 45 s, 12 min, 1h 30min.",
        }));
        return;
      }
      void patchExtraction(uploadId, e.id, { value: seconds });
      return;
    }
    const num = Number(raw.replace(",", "."));
    if (!Number.isFinite(num)) {
      setEditError((p) => ({ ...p, [e.id]: "Masukkan angka yang valid." }));
      return;
    }
    void patchExtraction(uploadId, e.id, { value: num });
  }

  // Konfirmasi satu-klik untuk baris ragu: nilai tetap, status jadi ok + tanda manual.
  function confirmOne(uploadId: string, e: Extraction) {
    void patchExtraction(
      uploadId,
      e.id,
      e.type === "text" ? { rawText: e.rawText } : { value: e.value }
    );
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInsightError((p) => ({ ...p, [sectionId]: data.error || `Generate insight gagal (kode ${res.status}).` }));
        return;
      }
      // Baru di-generate dari data terkini -> tidak basi.
      setInsights((p) => ({ ...p, [sectionId]: { ...data.insight, stale: false } }));
      // ...tapi kesimpulan platform ini merangkum poin insight yang kini sudah berubah.
      const platform =
        sections.find((s) => s.id === sectionId)?.platform ??
        saved.find((u) => u.sectionId === sectionId)?.platform;
      if (platform) {
        setConclusions((p) =>
          p[platform] ? { ...p, [platform]: { ...p[platform], stale: true } } : p
        );
      }
    } catch {
      setInsightError((p) => ({ ...p, [sectionId]: "Kesalahan jaringan." }));
    } finally {
      setInsightLoading((p) => ({ ...p, [sectionId]: false }));
    }
  }

  // --- Rekomendasi & Action Plan per platform (Fase A) ---
  // Murni ketikan user (tanpa AI), poin demi poin; disimpan via PUT, tanpa poin =
  // dihapus (slide dilewati).
  const [recoDraft, setRecoDraft] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialRecommendations.map((r) => [r.platform, r.points]))
  );
  // Nilai tersimpan terakhir, untuk mendeteksi ketikan yang belum disimpan. Rekomendasi
  // adalah satu-satunya konten yang diketik manual di halaman ini — kehilangannya paling
  // mahal, dan tombol Simpan ada di ATAS daftar poin sehingga mudah terlewat.
  const [recoSaved, setRecoSaved] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialRecommendations.map((r) => [r.platform, r.points]))
  );
  const [recoSaving, setRecoSaving] = useState<Record<string, boolean>>({});
  const [recoMessage, setRecoMessage] = useState<Record<string, string>>({});
  // Bandingkan versi TERNORMALISASI (poin ditrim, poin kosong dibuang — persis yang
  // disimpan server), supaya baris kosong yang baru ditambah belum dianggap "belum
  // tersimpan" sampai benar-benar diketik.
  const normReco = (arr?: string[]) =>
    (arr ?? []).map((s) => s.trim()).filter((s) => s !== "");
  const recoDirty = (platform: string) => {
    const a = normReco(recoDraft[platform]);
    const b = normReco(recoSaved[platform]);
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  };
  const setRecoPoint = (platform: string, index: number, value: string) => {
    setRecoDraft((p) => {
      const next = (p[platform] ?? []).slice();
      next[index] = value;
      return { ...p, [platform]: next };
    });
    setRecoMessage((p) => ({ ...p, [platform]: "" }));
  };
  const addRecoPoint = (platform: string) =>
    setRecoDraft((p) => ({ ...p, [platform]: [...(p[platform] ?? []), ""] }));
  const removeRecoPoint = (platform: string, index: number) => {
    setRecoDraft((p) => ({
      ...p,
      [platform]: (p[platform] ?? []).filter((_, i) => i !== index),
    }));
    setRecoMessage((p) => ({ ...p, [platform]: "" }));
  };

  // Cegah kehilangan ketikan rekomendasi saat tab ditutup/di-reload. (Navigasi internal
  // Next tidak memicu beforeunload — penanda "belum tersimpan" di atas yang menanganinya.)
  const hasUnsavedReco = platforms.some((pf) => recoDirty(pf));
  useEffect(() => {
    if (!hasUnsavedReco) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedReco]);

  async function saveRecommendation(platform: "shopee" | "tiktok") {
    setRecoSaving((p) => ({ ...p, [platform]: true }));
    setRecoMessage((p) => ({ ...p, [platform]: "" }));
    try {
      const res = await fetch(`/api/reports/${reportId}/recommendation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, points: recoDraft[platform] ?? [] }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRecoMessage((p) => ({ ...p, [platform]: data.error || `Gagal menyimpan (kode ${res.status}).` }));
        return;
      }
      const savedPoints: string[] = data.recommendation?.points ?? [];
      setRecoDraft((p) => ({ ...p, [platform]: savedPoints }));
      setRecoSaved((p) => ({ ...p, [platform]: savedPoints }));
      setRecoMessage((p) => ({
        ...p,
        [platform]: data.recommendation
          ? "Tersimpan — tampil sebagai slide Rekomendasi di PPT."
          : "Kosong — slide Rekomendasi dilewati saat generate PPT.",
      }));
    } catch {
      setRecoMessage((p) => ({ ...p, [platform]: "Kesalahan jaringan." }));
    } finally {
      setRecoSaving((p) => ({ ...p, [platform]: false }));
    }
  }

  // --- Kesimpulan Validator per platform (Tahap 7a+7b) ---
  // Satu tombol = cek konsistensi -> revisi (maks 1x/section) -> flag sisa -> kesimpulan.
  // Generate ulang MENGGANTI kesimpulan tersimpan.
  const [conclusions, setConclusions] = useState<Record<string, PlatformConclusion>>(() =>
    Object.fromEntries(initialConclusions.map((c) => [c.platform, c]))
  );
  // Audit Batch A — data section berubah => insight section itu DAN kesimpulan platformnya
  // jadi BASI. Server sudah menghitung ini, TAPI hanya saat halaman dimuat: tanpa penandaan
  // di client, layar tetap tampak segar setelah user mengoreksi angka, dan dialog peringatan
  // sebelum Unduh PPT tak pernah menyala — deck terkirim dengan narasi lama. Dipanggil dari
  // SETIAP mutasi data (unggah, hapus, ganti bulan, ekstrak, koreksi angka).
  function markStale(sectionId: string, platformHint?: string) {
    setInsights((p) =>
      p[sectionId] ? { ...p, [sectionId]: { ...p[sectionId], stale: true } } : p
    );
    const platform =
      platformHint ??
      sections.find((s) => s.id === sectionId)?.platform ??
      saved.find((u) => u.sectionId === sectionId)?.platform;
    if (!platform) return;
    setConclusions((p) =>
      p[platform] ? { ...p, [platform]: { ...p[platform], stale: true } } : p
    );
  }

  const [conclusionLoading, setConclusionLoading] = useState<Record<string, boolean>>({});
  const [conclusionError, setConclusionError] = useState<Record<string, string>>({});
  // Ringkasan cek konsistensi run terakhir (per platform) — transparansi hasil satu klik.
  const [conclusionInfo, setConclusionInfo] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<InsightRevisionView[]>(initialRevisions);
  const [flags, setFlags] = useState<FlagView[]>(initialFlags);

  async function generateConclusion(platform: "shopee" | "tiktok") {
    // Peringatan ringan (non-blocking): kesimpulan idealnya membaca SEMUA insight section
    // platform ini — section aktif yang belum punya insight membuatnya mungkin tak lengkap.
    const noInsight = sections.filter((s) => s.platform === platform && !insights[s.id]);
    if (noInsight.length > 0) {
      const ok = window.confirm(
        `${noInsight.length} section aktif ${platform === "shopee" ? "Shopee" : "TikTok"} belum punya insight:\n\n` +
          noInsight.map((s) => `• ${s.name}`).join("\n") +
          `\n\nKesimpulan mungkin tidak lengkap. Lanjut buat kesimpulan?`
      );
      if (!ok) return;
    }

    setConclusionLoading((p) => ({ ...p, [platform]: true }));
    setConclusionError((p) => ({ ...p, [platform]: "" }));
    try {
      const res = await fetch(`/api/reports/${reportId}/conclusions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConclusionError((p) => ({
          ...p,
          [platform]: data.error || `Generate kesimpulan gagal (kode ${res.status}).`,
        }));
        return;
      }
      // Baru dirangkum dari poin insight terkini -> tidak basi.
      setConclusions((p) => ({ ...p, [platform]: { ...data.conclusion, stale: false } }));
      // Tahap 7b: terapkan hasil cek konsistensi ke state — insight yang direvisi
      // Analyst, jejak revisinya, dan flag (server mengganti flag platform ini per run).
      for (const ins of (data.insights ?? []) as SectionInsight[]) {
        setInsights((p) => ({ ...p, [ins.sectionId]: { ...ins, stale: false } }));
      }
      if (Array.isArray(data.revisions) && data.revisions.length > 0) {
        setRevisions((p) => [...(data.revisions as InsightRevisionView[]), ...p]);
      }
      // Flag platform ini diganti TOTAL oleh hasil run barusan (inkonsistensi DAN
      // kelengkapan sama-sama ditulis ulang di server). Flag "periode" milik platform
      // lain / section lain tetap dipertahankan.
      setFlags((p) => [
        ...((data.flags ?? []) as FlagView[]),
        ...p.filter((f) => f.platform !== platform || f.type === "periode"),
      ]);
      if (data.consistency) {
        const c = data.consistency as {
          issuesFound: number;
          revised: number;
          escalated: number;
        };
        setConclusionInfo((p) => ({
          ...p,
          [platform]:
            c.issuesFound === 0
              ? "Cek konsistensi: tidak ada masalah."
              : `Cek konsistensi: ${c.issuesFound} temuan · ${c.revised} insight direvisi · ${c.escalated} flag.`,
        }));
      }
    } catch {
      setConclusionError((p) => ({ ...p, [platform]: "Kesalahan jaringan." }));
    } finally {
      setConclusionLoading((p) => ({ ...p, [platform]: false }));
    }
  }

  // --- Unduh PPT (Tahap 8) ---
  // Peringatan ringan sebelum generate: section berfoto yang belum punya insight akan
  // tampil foto saja — memberi tahu, TIDAK menghalangi (report selalu bisa jadi).
  // Unduh lewat fetch+blob (bukan window.location) supaya error server tampil DI DALAM
  // aplikasi, bukan memindahkan user ke halaman JSON mentah.
  const [pptxLoading, setPptxLoading] = useState(false);
  const [pptxError, setPptxError] = useState("");

  // Ambil nama file dari Content-Disposition (server sudah menyusunnya); fallback aman.
  function filenameFromDisposition(header: string | null): string {
    if (header) {
      const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
      if (utf8?.[1]) {
        try {
          return decodeURIComponent(utf8[1]);
        } catch {
          /* pakai fallback di bawah */
        }
      }
      const plain = /filename="([^"]+)"/i.exec(header);
      if (plain?.[1]) return plain[1];
    }
    return "Laporan Performa.pptx";
  }

  async function runPptxDownload() {
    setPptxLoading(true);
    setPptxError("");
    try {
      const res = await fetch(`/api/reports/${reportId}/pptx`);
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPptxError(data.error || `Gagal menyiapkan PPT (kode ${res.status}). Coba lagi.`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res.headers.get("Content-Disposition"));
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Ditunda: mencabut object URL pada tick yang sama dengan click() diketahui
      // membatalkan unduhan di Safari/Firefox — file .pptx tak pernah tersimpan dan
      // user tidak melihat error apa pun.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setPptxError("Kesalahan jaringan saat mengunduh PPT.");
    } finally {
      setPptxLoading(false);
    }
  }

  function downloadPptx() {
    const sectionIdsWithPhotos = [...new Set(saved.map((u) => u.sectionId))];
    const noInsight = sectionIdsWithPhotos.filter((id) => !insights[id]);
    // Audit P2/P3 — peringatkan juga kalau insight/kesimpulan BASI: PPT akan memakai teks
    // lama yang tak lagi cocok dengan angka terkini.
    const staleInsight = sectionIdsWithPhotos.filter((id) => insights[id]?.stale);
    const staleConcl = Object.values(conclusions).filter((c) => c.stale);
    const warnings: string[] = [];
    if (noInsight.length > 0) {
      const names = noInsight.map((id) => saved.find((u) => u.sectionId === id)?.sectionName ?? id);
      warnings.push(
        `${noInsight.length} section belum ada insight — akan tampil foto saja:\n` +
          names.map((n) => `• ${n}`).join("\n")
      );
    }
    if (staleInsight.length > 0) {
      const names = staleInsight.map(
        (id) => saved.find((u) => u.sectionId === id)?.sectionName ?? id
      );
      warnings.push(
        `${staleInsight.length} insight BASI (angka berubah sesudahnya) — PPT pakai teks lama:\n` +
          names.map((n) => `• ${n}`).join("\n")
      );
    }
    if (staleConcl.length > 0) {
      warnings.push(
        `${staleConcl.length} kesimpulan BASI (insight berubah sesudahnya) — buat ulang dulu kalau perlu.`
      );
    }
    if (warnings.length > 0) {
      const ok = window.confirm(`${warnings.join("\n\n")}\n\nLanjut unduh PPT?`);
      if (!ok) return;
    }
    void runPptxDownload();
  }

  const statusBadge: Record<ExtractionStatus, string> = {
    ok: "bg-ok/15 text-ok",
    low_confidence: "bg-warn/15 text-warn",
    missing: "bg-danger/15 text-danger",
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
      <div className="card p-6">
        <h2 className="text-sm font-medium text-fg">Unggah screenshot</h2>
        {noActiveSections ? (
          <p className="mt-2 text-sm text-warn">
            Tombol upload nonaktif karena belum ada section aktif untuk platform ini. Buat &amp;
            aktifkan section dulu di{" "}
            <a
              href="/dashboard/sections"
              className="font-medium underline underline-offset-2 hover:text-warn/80"
            >
              Section &amp; KB
            </a>{" "}
            (nama + KB + minimal 1 metrik), lalu tombol ini otomatis aktif.
          </p>
        ) : (
          <p className="mt-1 text-xs text-fg-3">
            Pilih satu atau beberapa gambar. Tiap foto wajib dilabeli ke satu section sebelum
            disimpan.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-block">
            <span
              className={`btn-ghost px-4 py-2 ${noActiveSections ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
            >
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
          {/* Satu tampilan yang terpotong jadi beberapa screenshot: digabung di client
              dulu, lalu masuk antrean yang sama sebagai SATU foto. */}
          <button
            onClick={() => setMergeOpen(true)}
            disabled={noActiveSections}
            title="Gabungkan beberapa potongan screenshot jadi satu foto"
            className="btn-ghost px-4 py-2 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Gabung foto
          </button>
        </div>
      </div>

      {mergeOpen && (
        <MergePhotosModal
          sections={sections}
          multiPlatform={multiPlatform}
          onClose={() => setMergeOpen(false)}
          onMerged={onMerged}
        />
      )}

      {/* (1c) Pengingat: section aktif yang fotonya belum ada (DESIGN §Alur UX) */}
      {!noActiveSections &&
        (missing.length > 0 ? (
          <div className="mt-4 rounded-[14px] border border-warn/30 bg-warn/10 p-4">
            <p className="text-xs font-medium text-warn">
              {missing.length} section aktif belum ada fotonya — lengkapi sebelum generate:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missing.map((s) => (
                <span
                  key={s.id}
                  className="badge bg-warn/15 text-warn"
                >
                  {sectionLabel(s)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          saved.length > 0 && (
            <p className="mt-4 text-xs text-ok">
              ✓ Semua section aktif sudah punya foto.
            </p>
          )
        ))}

      {/* Antrian belum disimpan */}
      {pending.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="label-sm">
            Belum disimpan ({pending.length})
          </h3>
          {pending.map((item) => (
            <div
              key={item.localId}
              className="flex gap-3 card p-4"
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
                <p className="truncate text-xs text-fg-3">{item.file.name}</p>
                <select
                  value={item.sectionId}
                  onChange={(e) => pickSectionFor(item.localId, e.target.value)}
                  className="mt-1.5 select w-full"
                >
                  <option value="">— pilih section —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sectionLabel(s)}
                    </option>
                  ))}
                </select>
                {/* Fase 1 — section ber-sub-grup: WAJIB pilih tool mana yang difoto.
                    Section biasa: blok ini tidak dirender sama sekali. */}
                {item.sectionId && sectionSubGroups(item.sectionId).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select
                      value={item.subGroupKey}
                      onChange={(e) =>
                        // Pilihan manual menang PERMANEN atas deteksi yang datang belakangan.
                        patchPending(item.localId, {
                          subGroupKey: e.target.value,
                          subGroupTouched: true,
                          subGroupDetected: false,
                          error: "",
                        })
                      }
                      className="select w-full"
                    >
                      <option value="">— sub-grup foto ini —</option>
                      {sectionSubGroups(item.sectionId).map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                    {item.periodDetecting && (
                      <span className="text-[10px] text-fg-3">membaca tab…</span>
                    )}
                    {item.subGroupDetected && (
                      <span
                        title={`Dicocokkan dari teks tab "${item.tabLabel ?? ""}". Ubah kapan saja.`}
                        className="badge bg-accent/15 px-2 text-[10px] text-accent-hi"
                      >
                        terdeteksi
                      </span>
                    )}
                    {!item.subGroupKey && !item.periodDetecting && item.tabLabel && (
                      <span className="text-[10px] text-warn">
                        tab &ldquo;{item.tabLabel}&rdquo; tidak cocok — pilih manual
                      </span>
                    )}
                  </div>
                )}

                {/* Poin 2 — section ber-perbandingan: pilih bulan foto (hanya salah satu
                    pasangan report). Status "periode utama" turunan, tak dipilih manual. */}
                {item.sectionId && sectionUsesComparison(item.sectionId) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    {monthOpts.length === 0 ? (
                      <span className="text-[11px] text-warn">
                        Report belum menetapkan periode — atur periode report dulu.
                      </span>
                    ) : (
                      <select
                        value={item.periodMonth}
                        onChange={(e) =>
                          // Pilihan manual menang PERMANEN atas deteksi yang datang belakangan.
                          patchPending(item.localId, {
                            periodMonth: e.target.value,
                            periodTouched: true,
                            periodDetected: false,
                            error: "",
                          })
                        }
                        className="select w-full"
                      >
                        <option value="">— bulan foto ini —</option>
                        {monthOpts.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                            {m.value === periodeUtama ? " (utama)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {item.periodDetecting && (
                      <span className="text-[10px] text-fg-3">mendeteksi bulan…</span>
                    )}
                    {item.periodDetected && (
                      <span
                        title="Dicocokkan dari teks periode di foto. Ubah kapan saja."
                        className="badge bg-accent/15 px-2 text-[10px] text-accent-hi"
                      >
                        terdeteksi
                      </span>
                    )}
                    {item.periodMonth && isPrimary(item.periodMonth) && (
                      <span className="badge bg-ok/15 px-2 text-[10px] text-ok">periode utama</span>
                    )}
                    {item.periodMismatch && (
                      <span className="text-[10px] text-warn">{item.periodMismatch}</span>
                    )}
                  </div>
                )}
                {item.error && <p className="mt-1 text-xs text-danger">{item.error}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => savePending(item)}
                    disabled={item.saving}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {item.saving ? "Menyimpan…" : "Simpan"}
                  </button>
                  <button
                    onClick={() => removePending(item.localId)}
                    disabled={item.saving}
                    className="btn-ghost px-3 py-1.5 text-xs"
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
          <h3 className="text-sm font-medium text-fg">
            Foto tersimpan ({saved.length})
          </h3>
          {saved.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={extractAll}
                disabled={Object.values(extracting).some(Boolean)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Ekstrak semua
              </button>
              <button
                onClick={downloadPptx}
                disabled={pptxLoading}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {pptxLoading ? "Menyiapkan…" : "Unduh PPT"}
              </button>
            </div>
          )}
        </div>
        {pptxError && (
          <p className="mt-2 rounded-[10px] border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            {pptxError}
          </p>
        )}
        {/* Ringkasan "Ekstrak semua": tanpa ini user harus menggulir seluruh daftar
            untuk menemukan foto mana yang gagal. */}
        {extractSummary && (
          <p className="mt-2 text-xs text-fg-3">{extractSummary}</p>
        )}
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-fg-3">Belum ada foto tersimpan.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groups.map((g) => {
              // Nama section: dari data upload; fallback ke daftar section aktif.
              const groupName = g.items[0]?.sectionName ?? sectionName(g.sectionId);
              return (
                <div key={g.sectionId}>
                  {/* Header grup: satu section, bisa >1 sumber terpisah */}
                  <div className="flex items-center gap-2">
                    <h4 className="label-sm">
                      {groupName}
                    </h4>
                    {g.multiSource && (
                      <span
                        title="Tiap foto dinarasikan sebagai sumber terpisah — tidak pernah digabung/dijumlah"
                        className="badge bg-accent/15 px-1.5 text-[10px] text-accent-hi"
                      >
                        {g.items.length} sumber terpisah
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-3">
                    {g.items.map((u, srcIdx) => {
                      // Foto section ber-sub-grup diberi label toolnya — tanpa ini
                      // operator tak bisa membedakan foto Flash Sale dari foto Voucher.
                      const sub =
                        sectionSubGroups(u.sectionId).length > 0
                          ? subGroupLabel(u.sectionId, u.subGroupKey)
                          : null;
                      const baseTitle = g.multiSource ? `Sumber #${srcIdx + 1}` : groupName;
                      const cardTitle = sub ? `${sub} · ${baseTitle}` : baseTitle;
                      const lightboxLabel = g.multiSource
                        ? `${groupName} — Sumber #${srcIdx + 1}`
                        : groupName;
                      return (
              <div key={u.id} className="card p-4">
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
                      <span className="truncate text-sm font-medium text-fg">
                        {cardTitle}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => extractOne(u.id)}
                          disabled={extracting[u.id]}
                          className="btn-primary px-3 py-1.5 text-xs"
                        >
                          {extracting[u.id]
                            ? "Mengekstrak…"
                            : u.extractions.length
                              ? "Ekstrak ulang"
                              : "Ekstrak angka"}
                        </button>
                        <button
                          onClick={() => deleteSaved(u)}
                          disabled={rowBusy[u.id]}
                          className="text-xs text-fg-3 hover:text-danger disabled:opacity-50"
                        >
                          {rowBusy[u.id] ? "Menghapus…" : "Hapus"}
                        </button>
                      </div>
                    </div>

                    {/* Tahap 6b — penanda periode foto (hanya section ber-perbandingan):
                        label bulan + badge Utama, ganti bulan & jadikan-utama via PATCH. */}
                    {sectionUsesComparison(u.sectionId) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <select
                          value={u.periodMonth ?? ""}
                          onChange={(e) => e.target.value && patchSavedPeriod(u, e.target.value)}
                          disabled={rowBusy[u.id]}
                          className="select px-2 py-1 text-xs disabled:opacity-50"
                        >
                          {!u.periodMonth && <option value="">— bulan? —</option>}
                          {monthOpts.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                              {m.value === periodeUtama ? " (utama)" : ""}
                            </option>
                          ))}
                          {/* Bulan lama di luar pasangan report tetap tampil apa adanya
                              (foto lama pra-Poin 2); operator memindahkannya ke pasangan. */}
                          {u.periodMonth &&
                            !monthOpts.some((m) => m.value === u.periodMonth) && (
                              <option value={u.periodMonth}>
                                {formatMonthID(u.periodMonth)} (di luar periode)
                              </option>
                            )}
                        </select>
                        {isPrimary(u.periodMonth) && (
                          <span className="badge bg-ok/15 px-2 text-[10px] text-ok">
                            Periode utama
                          </span>
                        )}
                      </div>
                    )}

                    {rowError[u.id] && (
                      <p className="mt-1 text-xs text-danger">{rowError[u.id]}</p>
                    )}
                    {extractError[u.id] && (
                      <p className="mt-1 text-xs text-danger">{extractError[u.id]}</p>
                    )}

                    {u.extractions.length === 0 ? (
                      <p className="mt-2 text-xs text-fg-3">Belum diekstrak.</p>
                    ) : u.extractions.every((e) => e.status === "missing") &&
                      !manualFill[u.id] ? (
                      // Foto kosong: SEMUA metrik missing -> pesan level-foto, tabel disembunyikan.
                      // Sebagian missing tidak masuk sini (tabel tetap tampil normal).
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-warn">
                          Tidak ada angka terbaca — mungkin bukan screenshot yang sesuai.
                        </p>
                        <button
                          onClick={() => setManualFill((p) => ({ ...p, [u.id]: true }))}
                          className="btn-ghost px-2 py-0.5 text-[10px]"
                        >
                          Isi manual
                        </button>
                      </div>
                    ) : (
                      <table className="mt-2 w-full text-xs">
                        <thead className="text-fg-3">
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
                              <tr key={e.id} className="border-t border-line align-top">
                                <td className="py-1 pr-2 text-fg-2">{e.key}</td>
                                <td className="py-1 pr-2 text-fg">
                                  {isEditing ? (
                                    <div>
                                      <input
                                        type="text"
                                        // Metrik teks diketik sebagai teks biasa; papan
                                        // ketik angka hanya untuk metrik numerik/durasi.
                                        inputMode={e.type === "text" ? "text" : "decimal"}
                                        maxLength={e.type === "text" ? MAX_TEXT_LENGTH : undefined}
                                        value={editDraft[e.id]}
                                        onChange={(ev) =>
                                          setEditDraft((p) => ({ ...p, [e.id]: ev.target.value }))
                                        }
                                        onKeyDown={(ev) => {
                                          if (ev.key === "Enter") saveEdit(u.id, e);
                                          if (ev.key === "Escape") cancelEdit(e.id);
                                        }}
                                        autoFocus
                                        placeholder="kosong = tidak ada"
                                        className={`input px-2 py-0.5 text-xs ${
                                          e.type === "text" ? "w-56" : "w-28"
                                        }`}
                                      />
                                      {editError[e.id] && (
                                        <p className="mt-0.5 text-[10px] text-danger">
                                          {editError[e.id]}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    // Mode baca saja: pemisah ribuan id-ID, murni kosmetik.
                                    // Input Edit diisi terpisah di startEdit, bukan dari teks ini.
                                    // Durasi ditampilkan manusiawi ("1j 23mnt"), bukan detik mentah.
                                    // Teks: nilainya memang di rawText (value selalu null).
                                    e.type === "text"
                                      ? (e.rawText ?? "—")
                                      : e.type === "duration" && e.value !== null
                                        ? formatDurationID(e.value)
                                        : formatValueID(e.value)
                                  )}
                                </td>
                                <td className="py-1 pr-2 text-fg-3 truncate max-w-[10rem]">
                                  {e.rawText ?? "—"}
                                </td>
                                <td className="py-1 pr-2 text-right text-fg-3">
                                  {e.status === "missing" ? "—" : e.confidence.toFixed(2)}
                                </td>
                                <td className="py-1 text-right">
                                  <span
                                    className={`badge px-1.5 text-[10px] ${statusBadge[e.status]}`}
                                  >
                                    {statusLabel[e.status]}
                                  </span>
                                  {e.manuallyConfirmed && (
                                    <span
                                      title="Sudah dikonfirmasi/dikoreksi manual"
                                      className="ml-1 badge bg-accent/15 px-1.5 text-[10px] text-accent-hi"
                                    >
                                      ✓ manual
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 pl-2 text-right whitespace-nowrap">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={() => saveEdit(u.id, e)}
                                        disabled={editSaving[e.id]}
                                        className="btn-primary px-2 py-0.5 text-[10px]"
                                      >
                                        {editSaving[e.id] ? "…" : "Simpan"}
                                      </button>
                                      <button
                                        onClick={() => cancelEdit(e.id)}
                                        disabled={editSaving[e.id]}
                                        className="ml-1 btn-ghost px-2 py-0.5 text-[10px]"
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
                                          className="btn-primary px-2 py-0.5 text-[10px]"
                                        >
                                          Konfirmasi
                                        </button>
                                      )}
                                      <button
                                        onClick={() => startEdit(e)}
                                        disabled={editSaving[e.id]}
                                        className="ml-1 btn-ghost px-2 py-0.5 text-[10px]"
                                      >
                                        Edit
                                      </button>
                                      {editError[e.id] && (
                                        <p className="mt-0.5 text-[10px] text-danger">
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
                      <div className="mt-2 card p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="label-sm">Insight</span>
                          <button
                            onClick={() => generateSectionInsight(g.sectionId)}
                            disabled={insightLoading[g.sectionId]}
                            className="btn-ghost px-3 py-1.5 text-xs"
                          >
                            {insightLoading[g.sectionId]
                              ? "Menganalisa…"
                              : insight
                                ? "Generate ulang"
                                : "Generate insight"}
                          </button>
                        </div>
                        {insightError[g.sectionId] && (
                          <p className="mt-1 text-xs text-danger">{insightError[g.sectionId]}</p>
                        )}
                        {insight ? (
                          <>
                            {insight.stale && (
                              <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">
                                Angka/foto berubah setelah insight ini dibuat — generate ulang
                                supaya sesuai data terkini.
                              </p>
                            )}
                            <BoldPoints points={insight.points} numbers={insight.numbers} />
                            <p className="mt-2 text-[10px] text-fg-3">
                              KB v{insight.kbVersion}
                              {insight.generator === "stub" && " · stub dev"} ·{" "}
                              {new Date(insight.updatedAt).toLocaleString("id-ID")}
                            </p>

                            {/* Jejak revisi Validator (Tahap 7b): before/after + alasan —
                                transparan, tidak ada perubahan diam-diam. Bold pakai
                                kosakata angka insight (angka tak berubah saat revisi). */}
                            {revisions
                              .filter((r) => r.sectionId === g.sectionId)
                              .map((rev) => {
                                const renderPoints = (points: string[]) => (
                                  <BoldPoints points={points} numbers={insight.numbers} small />
                                );
                                return (
                                  <div
                                    key={rev.id}
                                    className="mt-3 rounded-[10px] border border-line bg-ink p-3.5"
                                  >
                                    <p className="text-xs font-medium text-fg-2">
                                      Direvisi Validator ·{" "}
                                      {new Date(rev.createdAt).toLocaleString("id-ID")}
                                      {!rev.resolved && (
                                        <span className="ml-2 badge bg-warn/15 px-1.5 text-[10px] text-warn">
                                          masih bermasalah — ter-escalate (lihat Flag)
                                        </span>
                                      )}
                                    </p>
                                    <p className="mt-1 whitespace-pre-line text-[11px] text-fg-3">
                                      Alasan: {rev.reason}
                                    </p>
                                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                      <div>
                                        <p className="label-sm text-[10px]">
                                          Sebelum
                                        </p>
                                        {renderPoints(rev.pointsBefore)}
                                      </div>
                                      <div>
                                        <p className="label-sm text-[10px]">
                                          Sesudah
                                        </p>
                                        {renderPoints(rev.pointsAfter)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                          </>
                        ) : (
                          !insightError[g.sectionId] && (
                            <p className="mt-2 text-xs text-fg-3">
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

      {/* Flag — hasil escalate Validator (Tahap 7b) DAN peringatan salah-bulan dari
          Deteksi Bulan Otomatis (Jul 2026). WAJIB terlihat, bukan terkubur di log. */}
      {flags.length > 0 && (
        <div className="mt-8 rounded-[14px] border border-warn/30 bg-warn/5 p-4">
          <h3 className="text-sm font-medium text-warn">
            Flag ({flags.length}) — perlu dilihat
          </h3>
          <ul className="mt-2 space-y-2">
            {flags.map((f) => (
              <li key={f.id} className="text-xs text-fg-2">
                <span
                  className={`font-medium ${f.severity === "tinggi" ? "text-danger" : "text-warn"}`}
                >
                  ⚠ [{f.platform === "shopee" ? "Shopee" : "TikTok"}] {f.section}
                  {f.type !== "inkonsistensi" && (
                    <span
                      className={`ml-1.5 badge px-1.5 text-[10px] ${
                        f.severity === "tinggi"
                          ? "bg-danger/15 text-danger"
                          : "bg-surface-2 text-fg-3"
                      }`}
                    >
                      {f.type}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block whitespace-pre-line text-fg-3">
                  {f.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Kesimpulan Validator per platform (Tahap 7a+7b) — satu tombol menjalankan cek
          konsistensi -> revisi -> kesimpulan; mengisi slot Kesimpulan di PPT.
          Per-platform, tak pernah gabungan lintas-platform (DESIGN Prinsip #4). */}
      <div className="mt-8">
        <h3 className="text-sm font-medium text-fg-2">Kesimpulan</h3>
        <div className="mt-3 space-y-3">
          {platforms.map((platform) => {
            const conclusion = conclusions[platform];
            const label = platform === "shopee" ? "Shopee" : "TikTok";
            return (
              <div
                key={platform}
                className="card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="label-sm">
                    Kesimpulan {label}
                  </span>
                  <button
                    onClick={() => generateConclusion(platform)}
                    disabled={conclusionLoading[platform]}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    {conclusionLoading[platform]
                      ? "Memeriksa & merangkum…"
                      : conclusion
                        ? "Generate ulang"
                        : "Buat kesimpulan"}
                  </button>
                </div>
                {conclusionError[platform] && (
                  <p className="mt-1 text-xs text-danger">{conclusionError[platform]}</p>
                )}
                {conclusion ? (
                  <>
                    {conclusion.stale && (
                      <p className="mt-2 rounded-[10px] border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn">
                        Insight section berubah setelah kesimpulan ini dibuat — buat ulang
                        supaya rangkumannya sesuai.
                      </p>
                    )}
                    <BoldPoints points={conclusion.points} numbers={conclusion.numbers} />
                    <p className="mt-2 text-[10px] text-fg-3">
                      {conclusionInfo[platform] && `${conclusionInfo[platform]} · `}
                      {conclusion.generator === "stub" && "stub dev · "}
                      {new Date(conclusion.updatedAt).toLocaleString("id-ID")}
                    </p>
                  </>
                ) : (
                  !conclusionError[platform] && (
                    <p className="mt-2 text-xs text-fg-3">
                      Belum ada kesimpulan. Generate insight semua section {label} dulu, lalu
                      buat kesimpulan — hasilnya mengisi slide Kesimpulan di PPT.
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Rekomendasi & Action Plan per platform (Fase A) — POIN DEMI POIN, ketikan user
          manual (bukan AI). Tiap poin jadi satu bullet di slide Rekomendasi; tanpa poin =
          slide dilewati. */}
      <div className="mt-8">
        <h3 className="text-sm font-medium text-fg-2">Rekomendasi &amp; Action Plan</h3>
        <div className="mt-3 space-y-3">
          {platforms.map((platform) => {
            const label = platform === "shopee" ? "Shopee" : "TikTok";
            const points = recoDraft[platform] ?? [];
            return (
              <div
                key={platform}
                className="card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="label-sm">
                    Rekomendasi {label}
                    {recoDirty(platform) && (
                      <span className="ml-2 font-normal text-warn">• belum tersimpan</span>
                    )}
                  </span>
                  <button
                    onClick={() => saveRecommendation(platform)}
                    disabled={recoSaving[platform]}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    {recoSaving[platform] ? "Menyimpan…" : "Simpan"}
                  </button>
                </div>

                <div className="mt-2 space-y-2">
                  {points.length === 0 && (
                    <p className="text-xs text-fg-3">
                      Belum ada poin. Tambah poin di bawah — tiap poin jadi satu bullet di
                      slide (tanpa poin = slide dilewati).
                    </p>
                  )}
                  {points.map((pt, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-2.5 w-5 shrink-0 text-right text-xs tabular-nums text-fg-3">
                        {i + 1}.
                      </span>
                      <input
                        value={pt}
                        onChange={(e) => setRecoPoint(platform, i, e.target.value)}
                        placeholder={`Poin ${i + 1}`}
                        className="input flex-1"
                      />
                      <button
                        onClick={() => removeRecoPoint(platform, i)}
                        className="btn-ghost shrink-0 px-2.5 py-2 text-fg-3 hover:text-danger"
                        aria-label={`Hapus poin ${i + 1}`}
                        title="Hapus poin"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addRecoPoint(platform)}
                    className="btn-ghost px-3 py-1.5 text-xs"
                  >
                    + Tambah poin
                  </button>
                </div>

                {recoMessage[platform] && (
                  <p
                    className={`mt-2 text-xs ${recoMessage[platform].startsWith("Tersimpan") || recoMessage[platform].startsWith("Kosong") ? "text-ok" : "text-danger"}`}
                  >
                    {recoMessage[platform]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
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
            <span className="truncate text-sm text-fg-2">{lightbox.label}</span>
            <button
              onClick={() => setLightbox(null)}
              className="btn-ghost px-3 py-1"
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
