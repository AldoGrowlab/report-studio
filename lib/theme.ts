// Tahap 10 — logika tema, MURNI (tanpa DB): daftar font aman, normalisasi warna,
// tint, resolusi aksen per platform. Dipakai UI founder, validasi API, dan renderer PPT.

// Font yang AMAN di PPTX tanpa embed — tersedia di Office Windows & Mac.
export const SAFE_FONTS = [
  "Calibri",
  "Cambria",
  "Candara",
  "Corbel",
  "Constantia",
  "Segoe UI",
  "Arial",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Century Gothic",
  "Book Antiqua",
] as const;

export function isSafeFont(font: string): boolean {
  return (SAFE_FONTS as readonly string[]).includes(font);
}

// "#0F766E" / "0f766e" -> "0F766E"; tak valid -> null. Disimpan TANPA "#" (format pptxgenjs).
export function normalizeHexColor(input: string): string | null {
  const hex = input.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : null;
}

// Campur warna ke PUTIH: factor 0 = warna asli, 1 = putih. Deterministik — dipakai
// panel latar halus & garis pemisah supaya turunan tema, bukan warna lepas.
export function tint(hex: string, factor: number): string {
  const f = Math.min(1, Math.max(0, factor));
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(v + (255 - v) * f)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  };
  return `${channel(0)}${channel(2)}${channel(4)}`;
}

// Luminans persepsi sederhana (0.299R + 0.587G + 0.114B): penentu apakah warna cukup
// gelap untuk teks terang di atasnya. Dipakai renderer PPT supaya tema berprimer TERANG
// tidak menghasilkan teks putih di latar terang (kontras selalu terjaga).
export function isDarkColor(hex: string): boolean {
  const v = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return 0.299 * v(0) + 0.587 * v(2) + 0.114 * v(4) < 150;
}

// Bentuk tema yang dikonsumsi renderer PPT (lib/ppt.ts tetap murni — ini cuma data).
export type ThemeColors = {
  primary: string;
  secondary: string;
  accent: string; // aksen dasar
  accentOverride: boolean;
  accentShopee: string;
  accentTiktok: string;
  headingFont: string;
  bodyFont: string;
};

export const DEFAULT_THEME_COLORS: ThemeColors = {
  // Fase B (gaya agency): default primer HITAM — gaya report acuan. Tetap bisa diganti
  // founder di /dashboard/theme; hanya default-nya yang mengarah ke gaya agency.
  primary: "111111",
  secondary: "6B7280",
  accent: "2563EB",
  accentOverride: false,
  accentShopee: "EE4D2D",
  accentTiktok: "111827",
  headingFont: "Calibri",
  bodyFont: "Calibri",
};

// Aksen efektif satu blok platform: override ON -> aksen platform itu, OFF -> aksen dasar.
export function resolveAccent(theme: ThemeColors, platform: "shopee" | "tiktok"): string {
  if (!theme.accentOverride) return theme.accent;
  return platform === "shopee" ? theme.accentShopee : theme.accentTiktok;
}
