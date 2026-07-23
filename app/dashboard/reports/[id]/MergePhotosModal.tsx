"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampTrimValue,
  computeMergeLayout,
  detectDirection,
  MAX_MERGE_FILES,
  MIN_MERGE_FILES,
  NO_TRIM,
  type MergeDirection,
  type Trim,
} from "@/lib/merge-images";
import { MAX_UPLOAD_BYTES } from "@/lib/reports";

// Gabung Foto (Jul 2026) — PRA-PROSES DI CLIENT. Beberapa potongan screenshot dari satu
// tampilan digabung jadi SATU file, lalu masuk ke antrean unggah yang SUDAH ADA. Tidak ada
// endpoint baru, tidak ada perubahan schema: server tetap menerima satu foto seperti biasa.
// Irisan dibuang operator lewat crop interaktif — BUKAN deteksi otomatis berbasis konten
// (screenshot berulang tidak identik piksel; lihat lib/merge-images.ts & docs/DESIGN.md).

type SectionOption = {
  id: string;
  name: string;
  platform: "shopee" | "tiktok";
  usesPeriodComparison: boolean;
};

type Item = {
  localId: string;
  file: File;
  url: string;
  img: HTMLImageElement | null;
  width: number;
  height: number;
  trim: Trim;
};

// Preset per section, MURNI di localStorage (tanpa penyimpanan server): supaya potongan
// yang sama tidak perlu diatur ulang tiap bulan.
type MergePreset = {
  direction: MergeDirection;
  count: number;
  trims: Trim[];
};

const presetKey = (sectionId: string) => `mergePreset:${sectionId}`;

function readPreset(sectionId: string): MergePreset | null {
  try {
    const raw = window.localStorage.getItem(presetKey(sectionId));
    if (!raw) return null;
    const p = JSON.parse(raw) as MergePreset;
    if (
      (p.direction !== "vertical" && p.direction !== "horizontal") ||
      !Number.isInteger(p.count) ||
      !Array.isArray(p.trims) ||
      p.trims.length !== p.count
    ) {
      return null;
    }
    return p;
  } catch {
    // localStorage bisa tidak tersedia (mode privat) — preset itu kenyamanan, bukan syarat.
    return null;
  }
}

function writePreset(sectionId: string, preset: MergePreset) {
  try {
    window.localStorage.setItem(presetKey(sectionId), JSON.stringify(preset));
  } catch {
    /* diamkan — kegagalan preset tidak boleh menggagalkan penggabungan */
  }
}

function clearPreset(sectionId: string) {
  try {
    window.localStorage.removeItem(presetKey(sectionId));
  } catch {
    /* idem */
  }
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const HELP_TEXT =
  "Vertikal: untuk potongan atas-bawah / kartu carousel — buang bagian yang terulang " +
  "(header, grafik dobel) dengan menggeser garis potong. " +
  "Horizontal: untuk potongan kiri-kanan — ambil kedua screenshot pada zoom yang sama " +
  "TANPA scroll vertikal di antaranya; buang kolom yang terulang, lalu pastikan baris " +
  "tabel sejajar di preview.";

let mergeCounter = 0;

export default function MergePhotosModal({
  sections,
  multiPlatform,
  onClose,
  onMerged,
}: {
  sections: SectionOption[];
  multiPlatform: boolean;
  onClose: () => void;
  onMerged: (file: File, sectionId: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [direction, setDirection] = useState<MergeDirection>("vertical");
  const [autoDetected, setAutoDetected] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cermin `items` yang selalu mutakhir. Perubahan daftar datang dari DUA arah — aksi
  // operator dan callback `img.onload` (asinkron) — jadi keduanya menulis lewat
  // commitItems() agar tidak ada pembaruan yang menimpa pembaruan lain.
  const itemsRef = useRef<Item[]>([]);
  const presetAppliedRef = useRef(false);

  function commitItems(next: Item[]) {
    itemsRef.current = next;
    setItems(next);
  }
  function markPresetApplied(v: boolean) {
    presetAppliedRef.current = v;
    setPresetApplied(v);
  }

  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.url);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // --- Preset per section ---
  // Dijalankan dari AKSI (pilih section / tambah / buang foto), bukan dari effect: ini
  // reaksi terhadap perbuatan operator, bukan sinkronisasi ke sistem luar.
  function applyPreset(nextSectionId: string, list: Item[]) {
    if (!nextSectionId || list.length === 0) {
      markPresetApplied(false);
      return;
    }
    const preset = readPreset(nextSectionId);
    if (!preset || preset.count !== list.length) {
      markPresetApplied(false);
      return;
    }
    setDirection(preset.direction);
    setAutoDetected(false);
    commitItems(list.map((p, i) => ({ ...p, trim: preset.trims[i] ?? { ...NO_TRIM } })));
    markPresetApplied(true);
  }

  function pickSection(nextSectionId: string) {
    setSectionId(nextSectionId);
    applyPreset(nextSectionId, itemsRef.current);
  }

  function resetPreset() {
    if (sectionId) clearPreset(sectionId);
    markPresetApplied(false);
    commitItems(itemsRef.current.map((p) => ({ ...p, trim: { ...NO_TRIM } })));
  }

  // --- Pilih file ---
  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // izinkan pilih file yang sama lagi
    if (picked.length === 0) return;

    const prev = itemsRef.current;
    const room = MAX_MERGE_FILES - prev.length;
    if (room <= 0) {
      setSaveError(`Maksimal ${MAX_MERGE_FILES} foto sekali gabung.`);
      return;
    }
    setSaveError(
      picked.length > room
        ? `Maksimal ${MAX_MERGE_FILES} foto — ${picked.length - room} file terakhir diabaikan.`
        : ""
    );
    const added = picked.slice(0, room).map((file) => ({
      localId: `m${mergeCounter++}`,
      file,
      url: URL.createObjectURL(file),
      img: null,
      width: 0,
      height: 0,
      trim: { ...NO_TRIM },
    }));
    const next = [...prev, ...added];
    commitItems(next);
    applyPreset(sectionId, next);
    for (const it of added) loadImage(it);
  }

  // Muat dimensi asli. onload adalah callback dari sistem LUAR (dekode gambar), jadi di
  // sinilah tempat yang benar untuk memperbarui state — sekaligus menebak arah begitu
  // semua dimensi diketahui.
  function loadImage(item: Item) {
    const img = new Image();
    img.onload = () => {
      const next = itemsRef.current.map((p) =>
        p.localId === item.localId
          ? { ...p, img, width: img.naturalWidth, height: img.naturalHeight }
          : p
      );
      commitItems(next);
      if (presetAppliedRef.current) return; // preset menang atas tebakan
      if (next.length < MIN_MERGE_FILES || next.some((p) => !p.img)) return;
      const guess = detectDirection(next.map((p) => ({ width: p.width, height: p.height })));
      // Sinyal lemah = JANGAN menebak; default "Vertikal" dibiarkan apa adanya.
      if (guess) setDirection(guess);
      setAutoDetected(guess !== null);
    };
    img.onerror = () => setSaveError(`Gambar "${item.file.name}" tidak bisa dibaca.`);
    img.src = item.url;
  }

  const loaded = items.length > 0 && items.every((it) => it.img !== null);

  function removeItem(localId: string) {
    const it = itemsRef.current.find((p) => p.localId === localId);
    if (it) URL.revokeObjectURL(it.url);
    const next = itemsRef.current.filter((p) => p.localId !== localId);
    commitItems(next);
    applyPreset(sectionId, next);
    setSaveError("");
  }

  // Urutan gabung mengikuti DAFTAR ini, bukan nama file.
  function move(index: number, delta: number) {
    const to = index + delta;
    const prev = itemsRef.current;
    if (to < 0 || to >= prev.length) return;
    const next = prev.slice();
    [next[index], next[to]] = [next[to], next[index]];
    commitItems(next);
    markPresetApplied(false);
  }

  function setTrim(localId: string, side: keyof Trim, value: number) {
    commitItems(
      itemsRef.current.map((p) =>
        p.localId === localId
          ? { ...p, trim: { ...p.trim, [side]: clampTrimValue(p.trim, side, value) } }
          : p
      )
    );
    markPresetApplied(false);
  }

  function toggleDirection() {
    setDirection((d) => (d === "vertical" ? "horizontal" : "vertical"));
    setAutoDetected(false);
    markPresetApplied(false);
  }

  // --- Preview: dirender ulang tiap file/arah/urutan/trim berubah (debounce) ---
  // Kesiapan preview DITURUNKAN dari perbandingan tanda-tangan, bukan disimpan sebagai
  // state tersendiri: begitu ada yang diubah, tanda-tangannya beda dan tombol Simpan
  // otomatis mati sampai kanvas selesai digambar ulang. Tidak ada jendela waktu di mana
  // operator bisa menyimpan kanvas yang isinya sudah basi.
  const signature =
    items
      .map((it) => `${it.localId}:${it.width}x${it.height}:${it.trim.top},${it.trim.right},${it.trim.bottom},${it.trim.left}`)
      .join("|") + `#${direction}`;
  const [rendered, setRendered] = useState<{ sig: string; info: string; error: string } | null>(null);

  const renderPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const list = itemsRef.current;
    if (!canvas || list.length === 0 || list.some((it) => !it.img)) return;
    const res = computeMergeLayout(
      list.map((it) => ({ size: { width: it.width, height: it.height }, trim: it.trim })),
      direction
    );
    if (!res.ok) {
      setRendered({ sig: signature, info: "", error: res.error });
      return;
    }
    const { layout } = res;
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setRendered({ sig: signature, info: "", error: "Canvas tidak tersedia di browser ini." });
      return;
    }
    // Latar PUTIH: JPEG tak punya alpha, dan sela transparan akan jadi hitam saat diekspor.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    list.forEach((it, i) => {
      const p = layout.placements[i];
      if (it.img) ctx.drawImage(it.img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
    });
    setRendered({
      sig: signature,
      error: "",
      info:
        `${layout.width} × ${layout.height} px` +
        (layout.scaledDown ? " · diperkecil otomatis (batas 8000 px)" : ""),
    });
  }, [direction, signature]);

  useEffect(() => {
    const t = setTimeout(renderPreview, 150);
    return () => clearTimeout(t);
  }, [renderPreview]);

  const fresh = rendered !== null && rendered.sig === signature;
  const previewError = fresh ? rendered.error : "";
  const previewInfo = fresh ? rendered.info : "";
  const previewReady = loaded && fresh && rendered.error === "";

  // --- Simpan: canvas -> File, lalu masuk antrean unggah yang sudah ada ---
  async function saveMerged() {
    const canvas = canvasRef.current;
    if (!canvas || !previewReady) return;
    if (!sectionId) {
      setSaveError("Pilih label section dulu.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const toBlob = (type: string, quality?: number) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

      let blob = await toBlob("image/png");
      let ext = "png";
      let type = "image/png";
      if (!blob) {
        setSaveError("Gagal mengekspor hasil gabungan.");
        return;
      }
      // PNG lossless dipertahankan selama muat — ketajaman file menentukan akurasi
      // ekstraksi vision. JPEG hanya jalan mundur saat kena batas unggah.
      if (blob.size > MAX_UPLOAD_BYTES) {
        const jpg = await toBlob("image/jpeg", 0.9);
        if (!jpg || jpg.size > MAX_UPLOAD_BYTES) {
          setSaveError(
            `Hasil gabungan ${(( jpg ?? blob).size / 1024 / 1024).toFixed(1)} MB, melebihi batas 10 MB. ` +
              "Kurangi jumlah foto atau buang lebih banyak bagian yang terulang."
          );
          return;
        }
        blob = jpg;
        ext = "jpg";
        type = "image/jpeg";
      }

      const file = new File([blob], `gabungan_${Date.now()}.${ext}`, { type });
      writePreset(sectionId, {
        direction,
        count: items.length,
        trims: items.map((it) => ({ ...it.trim })),
      });
      for (const it of items) URL.revokeObjectURL(it.url);
      itemsRef.current = [];
      onMerged(file, sectionId);
    } catch {
      setSaveError("Gagal menyusun hasil gabungan.");
    } finally {
      setSaving(false);
    }
  }

  const sectionLabel = (s: SectionOption) =>
    multiPlatform ? `${s.platform === "shopee" ? "Shopee" : "TikTok"} — ${s.name}` : s.name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card my-6 w-full max-w-5xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-fg">Gabung foto</h2>
            <p className="mt-1 max-w-3xl text-xs text-fg-3">{HELP_TEXT}</p>
          </div>
          <button onClick={onClose} className="btn-ghost shrink-0 px-3 py-1 text-xs">
            Tutup ✕
          </button>
        </div>

        {/* Label section: menentukan preset yang dipakai & terbawa ke antrean unggah. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={sectionId}
            onChange={(e) => pickSection(e.target.value)}
            className="select"
          >
            <option value="">— pilih section —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionLabel(s)}
              </option>
            ))}
          </select>
          <label className="inline-block">
            <span className="btn-ghost cursor-pointer px-3 py-1.5 text-xs">
              Pilih potongan…
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
          </label>
          <span className="text-[11px] text-fg-3">
            {items.length}/{MAX_MERGE_FILES} foto (minimal {MIN_MERGE_FILES})
          </span>
        </div>

        {/* Arah gabung: default Vertikal, toggle satu klik. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={toggleDirection} className="btn-ghost px-3 py-1.5 text-xs">
            Arah: {direction === "vertical" ? "Vertikal ↓" : "Horizontal →"}
          </button>
          {autoDetected && (
            <span className="badge bg-accent/15 px-2 text-[10px] text-accent-hi">
              arah terdeteksi otomatis
            </span>
          )}
          {presetApplied && (
            <span className="badge bg-warn/15 px-2 text-[10px] text-warn">
              preset bulan lalu diterapkan — periksa preview
            </span>
          )}
          {sectionId && (
            <button
              onClick={resetPreset}
              className="text-[11px] text-fg-3 underline underline-offset-2 hover:text-fg-2"
            >
              Reset preset
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="mt-4 text-xs text-fg-3">
            Belum ada foto dipilih. Pilih {MIN_MERGE_FILES}–{MAX_MERGE_FILES} potongan dari
            satu tampilan yang sama.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <TrimCard
                key={it.localId}
                item={it}
                index={i}
                total={items.length}
                onMove={move}
                onRemove={removeItem}
                onTrim={setTrim}
              />
            ))}
          </div>
        )}

        {/* Preview WAJIB: tombol simpan baru hidup setelah ini ter-render. */}
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <span className="label-sm">Preview hasil</span>
            <span className="text-[11px] text-fg-3">{previewReady ? previewInfo : ""}</span>
          </div>
          {previewError && <p className="mt-1 text-xs text-danger">{previewError}</p>}
          <div className="mt-2 flex max-h-[360px] justify-center overflow-auto rounded-[10px] border border-line bg-white p-2">
            <canvas ref={canvasRef} className="h-auto max-h-[340px] w-auto max-w-full" />
          </div>
          {!previewReady && !previewError && (
            <p className="mt-1 text-xs text-fg-3">
              {items.length < MIN_MERGE_FILES
                ? `Pilih minimal ${MIN_MERGE_FILES} foto.`
                : "Menyiapkan preview…"}
            </p>
          )}
        </div>

        {saveError && <p className="mt-3 text-xs text-danger">{saveError}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost px-3 py-1.5 text-xs">
            Batal
          </button>
          <button
            onClick={saveMerged}
            disabled={!previewReady || saving || !sectionId}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {saving ? "Menyusun…" : "Gabungkan & tambahkan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Satu thumbnail + 4 handle potong yang bisa digeser. Nilai disimpan sebagai FRAKSI 0..1
// per sisi (bukan piksel) supaya preset tetap benar walau resolusi antar bulan berbeda.
function TrimCard({
  item,
  index,
  total,
  onMove,
  onRemove,
  onTrim,
}: {
  item: Item;
  index: number;
  total: number;
  onMove: (index: number, delta: number) => void;
  onRemove: (localId: string) => void;
  onTrim: (localId: string, side: keyof Trim, value: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  function startDrag(side: keyof Trim) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = boxRef.current;
      if (!box) return;
      const apply = (clientX: number, clientY: number) => {
        const r = box.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const v =
          side === "top"
            ? (clientY - r.top) / r.height
            : side === "bottom"
              ? (r.bottom - clientY) / r.height
              : side === "left"
                ? (clientX - r.left) / r.width
                : (r.right - clientX) / r.width;
        onTrim(item.localId, side, v);
      };
      apply(e.clientX, e.clientY);
      const onMoveEv = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
      const onUp = () => {
        window.removeEventListener("pointermove", onMoveEv);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMoveEv);
      window.addEventListener("pointerup", onUp);
    };
  }

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

  return (
    <div className="rounded-[10px] border border-line bg-ink p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] text-fg-2">
          #{index + 1} · {item.file.name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            title="Naikkan urutan"
            className="btn-ghost px-1.5 py-0.5 text-[10px] disabled:opacity-40"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(index, 1)}
            disabled={index === total - 1}
            title="Turunkan urutan"
            className="btn-ghost px-1.5 py-0.5 text-[10px] disabled:opacity-40"
          >
            ↓
          </button>
          <button
            onClick={() => onRemove(item.localId)}
            title="Buang foto ini"
            className="px-1 text-[11px] text-fg-3 hover:text-danger"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        ref={boxRef}
        className="relative mt-1.5 w-full touch-none select-none overflow-hidden rounded bg-black/20"
        style={{ aspectRatio: `${item.width || 1} / ${item.height || 1}`, maxHeight: 260 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.file.name}
          draggable={false}
          className="absolute inset-0 h-full w-full object-fill"
        />
        {/* Area terbuang diberi overlay gelap — operator melihat persis apa yang hilang. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/65" style={{ height: pct(item.trim.top) }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/65" style={{ height: pct(item.trim.bottom) }} />
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/65" style={{ width: pct(item.trim.left) }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/65" style={{ width: pct(item.trim.right) }} />

        {SIDES.map((side) => {
          const horizontalBar = side === "top" || side === "bottom";
          return (
            <div
              key={side}
              onPointerDown={startDrag(side)}
              title={`Geser untuk memotong dari ${
                { top: "atas", bottom: "bawah", left: "kiri", right: "kanan" }[side]
              }`}
              className={`absolute bg-accent/70 hover:bg-accent ${
                horizontalBar
                  ? "inset-x-0 h-2.5 cursor-ns-resize"
                  : "inset-y-0 w-2.5 cursor-ew-resize"
              }`}
              style={{ [side]: pct(item.trim[side]) }}
            />
          );
        })}
      </div>

      <p className="mt-1 text-[10px] text-fg-3">
        {item.width > 0 ? `${item.width}×${item.height}` : "memuat…"} · potong{" "}
        {SIDES.filter((s) => item.trim[s] > 0)
          .map((s) => `${{ top: "A", bottom: "B", left: "K", right: "N" }[s]} ${(item.trim[s] * 100).toFixed(0)}%`)
          .join(" · ") || "0%"}
      </p>
    </div>
  );
}
