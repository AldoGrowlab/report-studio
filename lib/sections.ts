import type { Platform, MetricType, SectionStatus } from "@prisma/client";
import { DEFAULT_SUB_GROUP_KEY, normalizeLabelForMatch } from "@/lib/subgroups";
import type { DerivedMetricDef, MetricRef } from "@/lib/derived";

// Tipe metrik yang masuk dari request (sebelum disimpan). Fase 1: tiap metrik MEMBAWA
// sub-grup pemiliknya. Section tanpa sub-grup memakai sentinel "_default" — perilaku lama.
export type MetricInput = {
  key: string;
  label: string;
  type: MetricType;
  required: boolean;
  subGroupKey: string;
};

// Sub-grup section (Fase 1) — mis. Flash Sale / Diskon / Voucher pada Promotion Tools.
export type SubGroupInput = {
  key: string;
  label: string;
  aliases: string[];
  order: number;
};

// Tipe payload section yang sudah divalidasi & dinormalisasi
export type SectionInput = {
  platform: Platform;
  name: string;
  narrativeOrder: number;
  kbAnalysis: string;
  // Tahap 6b — section ini pakai perbandingan periode (opt-in founder).
  usesPeriodComparison: boolean;
  // DATAR, dengan subGroupKey terstempel — bentuknya persis seperti yang disimpan,
  // sehingga route cukup deleteMany + createMany seperti sebelumnya.
  metrics: MetricInput[];
  subGroups: SubGroupInput[];
  // Fase 2 — metrik turunan. Ref-nya baru bisa DIVALIDASI di route (butuh katalog metrik
  // seluruh KB, lintas section); di sini hanya bentuknya yang diperiksa.
  derivedMetrics: DerivedMetricDef[];
};

const METRIC_TYPES: MetricType[] = [
  "number",
  "currency",
  "percent",
  "ratio",
  "duration",
  "text",
];

// Kunci sub-grup dipakai di URL/localStorage/ref metrik turunan, jadi bentuknya dikunci
// ketat sejak awal — jauh lebih murah daripada memperbaiki data yang sudah telanjur.
const SUB_GROUP_KEY_RE = /^[a-z0-9_]{1,40}$/;
const MAX_ALIASES = 12;

// Aturan inti: section "active" hanya kalau lengkap
// (nama terisi + KB terisi + minimal 1 metrik). Selain itu "draft".
export function computeSectionStatus(input: {
  name: string;
  kbAnalysis: string;
  metricsCount: number;
}): SectionStatus {
  const complete =
    input.name.trim().length > 0 &&
    input.kbAnalysis.trim().length > 0 &&
    input.metricsCount >= 1;
  return complete ? "active" : "draft";
}

// Validasi + normalisasi body request menjadi SectionInput.
// Mengembalikan { data } kalau valid, atau { error } kalau tidak.
export type ParseResult =
  | { ok: true; data: SectionInput }
  | { ok: false; error: string };

// Satu daftar metrik (milik satu sub-grup) -> MetricInput[]. Nama metrik unik DI DALAM
// sub-grup saja: "Penjualan" boleh ada di Flash Sale DAN di Voucher — justru itu tujuannya.
function parseMetricList(
  raw: unknown,
  subGroupKey: string,
  scopeLabel: string
): { ok: true; metrics: MetricInput[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const metrics: MetricInput[] = [];
  const seenKeys = new Set<string>();

  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: `Format metrik ${scopeLabel} tidak valid.` };
    }
    const m = item as Record<string, unknown>;
    const key = typeof m.key === "string" ? m.key.trim() : "";
    const label = typeof m.label === "string" ? m.label.trim() : "";

    // Lewati baris yang benar-benar kosong (key & label kosong)
    if (!key && !label) continue;

    if (!key) {
      return { ok: false, error: `Setiap metrik ${scopeLabel} wajib punya key.` };
    }
    if (!label) {
      return { ok: false, error: `Metrik "${key}" ${scopeLabel} wajib punya label.` };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: `Key metrik "${key}" tidak boleh dobel ${scopeLabel}.` };
    }
    seenKeys.add(key);

    const type = m.type;
    if (!METRIC_TYPES.includes(type as MetricType)) {
      return { ok: false, error: `Tipe metrik "${key}" ${scopeLabel} tidak valid.` };
    }

    metrics.push({
      key,
      label,
      type: type as MetricType,
      required: Boolean(m.required),
      subGroupKey,
    });
  }

  return { ok: true, metrics };
}

// Satu ref operan metrik turunan: platform + section + sub-grup + nama metrik.
function parseRef(raw: unknown, what: string): { ok: true; ref: MetricRef } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: `${what} belum diisi.` };
  }
  const r = raw as Record<string, unknown>;
  const platform = r.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return { ok: false, error: `${what}: platform harus shopee atau tiktok.` };
  }
  const section = typeof r.section === "string" ? r.section.trim() : "";
  if (!section) return { ok: false, error: `${what}: nama section wajib diisi.` };
  const metricKey = typeof r.metricKey === "string" ? r.metricKey.trim() : "";
  if (!metricKey) return { ok: false, error: `${what}: nama metrik wajib diisi.` };
  const sub = typeof r.subGroupKey === "string" ? r.subGroupKey.trim() : "";
  return {
    ok: true,
    ref: { platform, section, subGroupKey: sub === "" ? DEFAULT_SUB_GROUP_KEY : sub, metricKey },
  };
}

// Metrik turunan dari body. BENTUKNYA saja yang diperiksa di sini — apakah ref-nya
// menunjuk sesuatu yang benar-benar ada divalidasi di route (butuh katalog lintas section).
function parseDerivedMetrics(
  raw: unknown
): { ok: true; defs: DerivedMetricDef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: true, defs: [] };
  const defs: DerivedMetricDef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "Format metrik turunan tidak valid." };
    }
    const d = item as Record<string, unknown>;
    const key = typeof d.key === "string" ? d.key.trim() : "";
    const label = typeof d.label === "string" ? d.label.trim() : "";
    if (!key && !label) continue; // baris kosong dilewati (pola sama dengan metrik)
    if (!key) return { ok: false, error: "Setiap metrik turunan wajib punya key." };
    if (!label) return { ok: false, error: `Metrik turunan "${key}" wajib punya label.` };

    const num = parseRef(d.numeratorRef, `Pembilang metrik turunan "${key}"`);
    if (!num.ok) return { ok: false, error: num.error };
    const den = parseRef(d.denominatorRef, `Penyebut metrik turunan "${key}"`);
    if (!den.ok) return { ok: false, error: den.error };

    const sub = typeof d.subGroupKey === "string" ? d.subGroupKey.trim() : "";
    const notes = typeof d.notes === "string" ? d.notes.trim() : "";
    defs.push({
      key,
      label,
      subGroupKey: sub === "" ? DEFAULT_SUB_GROUP_KEY : sub,
      numeratorRef: num.ref,
      denominatorRef: den.ref,
      unit: "percent",
      ...(notes ? { notes } : {}),
    });
  }
  return { ok: true, defs };
}

export function parseSectionBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  const b = body as Record<string, unknown>;

  const platform = b.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return { ok: false, error: "Platform harus shopee atau tiktok." };
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    return { ok: false, error: "Nama section wajib diisi." };
  }

  // narrativeOrder: terima number atau string angka, default 0
  let narrativeOrder = 0;
  if (b.narrativeOrder !== undefined && b.narrativeOrder !== null && b.narrativeOrder !== "") {
    const n = Number(b.narrativeOrder);
    if (!Number.isInteger(n)) {
      return { ok: false, error: "Narrative order harus berupa angka bulat." };
    }
    // Kolomnya Int (int4 Postgres). Nilai di luar rentang lolos validasi lama lalu
    // ditolak di lapisan DB sebagai 500 tanpa pesan — cukup salah ketik nol berlebih.
    if (n < 0 || n > 9999) {
      return { ok: false, error: "Narrative order harus antara 0 dan 9999." };
    }
    narrativeOrder = n;
  }

  const kbAnalysis = typeof b.kbAnalysis === "string" ? b.kbAnalysis : "";

  // ---- Sub-grup (Fase 1) ----
  const rawSubGroups = Array.isArray(b.subGroups) ? b.subGroups : [];
  const subGroups: SubGroupInput[] = [];
  const metrics: MetricInput[] = [];
  const seenSubKeys = new Set<string>();
  // Alias & label dikumpulkan LINTAS sub-grup: dua tool yang punya alias sama membuat
  // pencocokan tab jadi tebakan, dan foto bisa masuk sub-grup yang salah tanpa gejala.
  const seenMatchTexts = new Map<string, string>();

  for (const item of rawSubGroups) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "Format sub-grup tidak valid." };
    }
    const g = item as Record<string, unknown>;
    const key = typeof g.key === "string" ? g.key.trim().toLowerCase() : "";
    const label = typeof g.label === "string" ? g.label.trim() : "";

    // Baris sub-grup yang benar-benar kosong dilewati (pola sama dengan baris metrik).
    if (!key && !label) continue;

    if (!key) {
      return { ok: false, error: `Sub-grup "${label}" wajib punya key.` };
    }
    if (!SUB_GROUP_KEY_RE.test(key)) {
      return {
        ok: false,
        error: `Key sub-grup "${key}" hanya boleh huruf kecil, angka, dan garis bawah (maks 40 karakter).`,
      };
    }
    if (key === DEFAULT_SUB_GROUP_KEY) {
      return {
        ok: false,
        error: `Key sub-grup "${DEFAULT_SUB_GROUP_KEY}" dipakai sistem untuk section tanpa sub-grup — pakai key lain.`,
      };
    }
    if (!label) {
      return { ok: false, error: `Sub-grup "${key}" wajib punya label.` };
    }
    if (seenSubKeys.has(key)) {
      return { ok: false, error: `Key sub-grup "${key}" tidak boleh dobel dalam satu section.` };
    }
    seenSubKeys.add(key);

    const rawAliases = Array.isArray(g.aliases) ? g.aliases : [];
    if (rawAliases.length > MAX_ALIASES) {
      return { ok: false, error: `Sub-grup "${key}" maksimal ${MAX_ALIASES} alias.` };
    }
    const aliases: string[] = [];
    for (const a of rawAliases) {
      if (typeof a !== "string") {
        return { ok: false, error: `Alias sub-grup "${key}" harus berupa teks.` };
      }
      const alias = a.trim();
      if (alias === "") continue;
      if (!aliases.some((x) => normalizeLabelForMatch(x) === normalizeLabelForMatch(alias))) {
        aliases.push(alias);
      }
    }

    // Label sendiri ikut jadi teks pencocokan, jadi bentroknya pun harus tertangkap.
    for (const text of [label, ...aliases]) {
      const norm = normalizeLabelForMatch(text);
      if (norm === "") continue;
      const owner = seenMatchTexts.get(norm);
      if (owner && owner !== key) {
        return {
          ok: false,
          error: `Teks "${text}" dipakai sub-grup "${owner}" dan "${key}" — pencocokan tab jadi ambigu.`,
        };
      }
      seenMatchTexts.set(norm, key);
    }

    const parsedMetrics = parseMetricList(g.expectedMetrics, key, `sub-grup "${key}"`);
    if (!parsedMetrics.ok) return { ok: false, error: parsedMetrics.error };
    metrics.push(...parsedMetrics.metrics);

    subGroups.push({ key, label, aliases, order: subGroups.length });
  }

  // ---- Metrik section (tanpa sub-grup) ----
  const parsedFlat = parseMetricList(b.metrics, DEFAULT_SUB_GROUP_KEY, "section");
  if (!parsedFlat.ok) return { ok: false, error: parsedFlat.error };

  // Campuran metrik ber-sub-grup dan tanpa sub-grup DITOLAK: saat mengekstrak satu foto,
  // sistem harus tahu PASTI daftar metrik mana yang berlaku. Kalau keduanya ada, jawabannya
  // ambigu — dan ambiguitas di jalur angka melanggar Prinsip #1.
  if (subGroups.length > 0 && parsedFlat.metrics.length > 0) {
    return {
      ok: false,
      error:
        "Section ini punya sub-grup, jadi semua metrik harus berada di dalam sub-grup. " +
        "Pindahkan metrik section ke salah satu sub-grup.",
    };
  }
  metrics.push(...parsedFlat.metrics);

  // Sub-grup tanpa satu pun metrik = tidak ada yang bisa diekstrak dari fotonya.
  const metricCountByGroup = new Map<string, number>();
  for (const m of metrics) {
    metricCountByGroup.set(m.subGroupKey, (metricCountByGroup.get(m.subGroupKey) ?? 0) + 1);
  }
  for (const g of subGroups) {
    if ((metricCountByGroup.get(g.key) ?? 0) === 0) {
      return { ok: false, error: `Sub-grup "${g.label}" belum punya metrik.` };
    }
  }

  // ---- Metrik turunan (Fase 2) ----
  // Satu nama metrik tidak boleh sekaligus hasil ekstraksi DAN hasil hitungan: keduanya
  // menulis ke identitas yang sama, dan yang belakangan menimpa yang duluan tanpa jejak.
  const parsedDerived = parseDerivedMetrics(b.derivedMetrics);
  if (!parsedDerived.ok) return { ok: false, error: parsedDerived.error };
  const derived = parsedDerived.defs;
  const extractedScoped = new Set(metrics.map((m) => `${m.subGroupKey}/${m.key}`));
  const seenDerived = new Set<string>();
  for (const d of derived) {
    const scoped = `${d.subGroupKey}/${d.key}`;
    if (extractedScoped.has(scoped)) {
      return {
        ok: false,
        error: `Metrik "${d.key}" terdaftar sekaligus sebagai metrik ekstraksi dan metrik turunan — pilih salah satu.`,
      };
    }
    if (seenDerived.has(scoped)) {
      return { ok: false, error: `Metrik turunan "${d.key}" tidak boleh dobel.` };
    }
    seenDerived.add(scoped);
  }

  return {
    ok: true,
    data: {
      platform,
      name,
      narrativeOrder,
      kbAnalysis,
      usesPeriodComparison: Boolean(b.usesPeriodComparison),
      metrics,
      subGroups,
      derivedMetrics: derived,
    },
  };
}

export { METRIC_TYPES };
