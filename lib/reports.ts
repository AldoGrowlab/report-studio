import type { SessionData } from "@/lib/session";

// Batas ukuran file upload (10 MB) — screenshot wajar di bawah ini.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Aturan akses report: founder bisa semua, user hanya report miliknya.
export function canAccessReport(
  session: SessionData,
  report: { createdById: string }
): boolean {
  return session.role === "founder" || report.createdById === session.userId;
}
