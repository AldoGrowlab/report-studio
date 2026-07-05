// Tahap 3 (perbaikan UI) — logika murni tampilan upload, dapat diuji tanpa DB/React.
// 1) Deteksi section aktif yang fotonya belum ada (DESIGN: "sistem deteksi & ingatkan user").
// 2) Kelompokkan foto per section dengan indeks sumber — DESIGN: dua+ foto untuk section sama
//    adalah SUMBER TERPISAH (tidak pernah digabung), UI harus menandainya jelas.

// Format angka untuk MODE BACA saja: pemisah ribuan gaya Indonesia (292513820 -> "292.513.820",
// 23.5 -> "23,5"). Murni kosmetik render — nilai tersimpan & input Edit tak pernah lewat sini.
// maximumFractionDigits: 20 mencegah pembulatan diam-diam.
export function formatValueID(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("id-ID", { maximumFractionDigits: 20 });
}

// Section aktif yang belum punya foto tersimpan, urutan input dipertahankan
// (dropdown sudah urut narrativeOrder).
export function missingPhotoSections<S extends { id: string }>(
  activeSections: S[],
  savedSectionIds: string[]
): S[] {
  const have = new Set(savedSectionIds);
  return activeSections.filter((s) => !have.has(s.id));
}

export type UploadGroup<U> = {
  sectionId: string;
  items: U[]; // urutan input dipertahankan (createdAt asc) -> indeks array = nomor sumber - 1
  multiSource: boolean; // >1 foto = sumber terpisah, WAJIB ditandai di UI
};

// Kelompokkan upload per section. Urutan grup mengikuti sectionOrder (narrativeOrder);
// section yang tak ada di daftar itu (mis. sudah nonaktif) tetap muncul, di belakang,
// sesuai urutan kemunculan pertama.
export function groupBySection<U extends { sectionId: string }>(
  uploads: U[],
  sectionOrder: string[]
): UploadGroup<U>[] {
  const bySection = new Map<string, U[]>();
  for (const u of uploads) {
    const list = bySection.get(u.sectionId);
    if (list) list.push(u);
    else bySection.set(u.sectionId, [u]);
  }

  const ordered: UploadGroup<U>[] = [];
  const emitted = new Set<string>();
  for (const id of sectionOrder) {
    const items = bySection.get(id);
    if (items && !emitted.has(id)) {
      emitted.add(id);
      ordered.push({ sectionId: id, items, multiSource: items.length > 1 });
    }
  }
  // Sisa: section di luar sectionOrder, urutan kemunculan pertama di uploads.
  for (const [id, items] of bySection) {
    if (!emitted.has(id)) {
      emitted.add(id);
      ordered.push({ sectionId: id, items, multiSource: items.length > 1 });
    }
  }
  return ordered;
}
