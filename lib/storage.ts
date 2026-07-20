import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// Abstraksi penyimpanan gambar upload.
// - Produksi: Cloudflare R2 (S3-compatible) — bucket private, disajikan via presigned URL.
// - Dev (env R2 belum diisi): fallback ke disk lokal di .uploads/ (gitignored),
//   disajikan dengan streaming lewat route ber-auth.
// Route penyaji (GET /api/uploads/[id]/image) tidak perlu tahu backend mana:
// ia memanggil serve(key) dan menerima "redirect" (presigned) atau "stream" (bytes).

export type ServeResult =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; bytes: Uint8Array; contentType: string };

export type ImageBytes = { bytes: Uint8Array; contentType: string };

export type Storage = {
  backend: "r2" | "local";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  serve(key: string): Promise<ServeResult | null>;
  // Ambil bytes mentah (untuk dipakai server-side, mis. dikirim ke Claude).
  read(key: string): Promise<ImageBytes | null>;
};

// Ekstensi gambar yang diizinkan -> content-type
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function isAllowedImageType(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

// Bangun object key. cuid dipakai untuk nama file biar tak bisa ditebak.
export function buildImageKey(reportId: string, mime: string): string {
  return `reports/${reportId}/${randomUUID()}.${extForMime(mime)}`;
}

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// ---- R2 (S3-compatible) ----
function r2Config() {
  const { R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return {
      bucket: R2_BUCKET,
      endpoint: R2_ENDPOINT,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    };
  }
  return null;
}

function createR2Storage(cfg: NonNullable<ReturnType<typeof r2Config>>): Storage {
  // Import dinamis: SDK AWS hanya dimuat kalau R2 benar-benar dipakai.
  // Klien DIPAKAI ULANG (dulu `new S3Client` tiap panggilan): route pptx membaca foto satu
  // per satu, jadi report 30 foto membuat 30 klien baru — 30 kali resolusi kredensial dan
  // nol penggunaan ulang koneksi HTTP. Promise-nya di-cache supaya panggilan bersamaan
  // tetap berbagi satu instance.
  let clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  async function client() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      return new S3Client({
        region: "auto", // R2 mengabaikan region; "auto" sesuai dok R2
        endpoint: cfg.endpoint,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
        // AWS SDK v3 baru menambahkan checksum flexible (CRC32) secara default —
        // Cloudflare R2 menolaknya dengan 400 InvalidArgument. Batasi checksum ke
        // "hanya saat operasi mewajibkan" supaya kompatibel dengan R2.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    })();
    return clientPromise;
  }

  return {
    backend: "r2",
    async put(key, bytes, contentType) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await client();
      await c.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: contentType })
      );
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await client();
      await c.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async serve(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const c = await client();
      const url = await getSignedUrl(c, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: 60, // TTL pendek: URL hanya valid sebentar
      });
      return { kind: "redirect", url };
    },
    async read(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const c = await client();
      try {
        const res = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if (!res.Body) return null;
        // transformToByteArray tersedia di stream body SDK v3.
        const bytes = await res.Body.transformToByteArray();
        return { bytes, contentType: res.ContentType ?? contentTypeForKey(key) };
      } catch (e) {
        // HANYA "objek tidak ada" yang sah dijawab null (foto memang hilang — pemanggil
        // mencatatnya sebagai missingPhotos dan report tetap selesai, Prinsip #3).
        // Kegagalan lain (kredensial dirotasi, jaringan, bucket salah) WAJIB dilempar:
        // kalau ikut jadi null, gangguan R2 menyamar sebagai "foto belum diunggah" dan
        // PPT terkirim tanpa satu pun foto dengan HTTP 200 (temuan audit Batch B).
        if (isNotFoundError(e)) return null;
        throw e;
      }
    },
  };
}

// "Objek tidak ada" pada S3/R2 muncul dalam beberapa bentuk tergantung operasi:
// NoSuchKey (GetObject), NotFound (HeadObject), atau HTTP 404 tanpa nama error.
function isNotFoundError(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === "NoSuchKey" ||
    err?.name === "NotFound" ||
    err?.$metadata?.httpStatusCode === 404
  );
}

// ---- Disk lokal (fallback dev) ----
const LOCAL_ROOT = path.join(process.cwd(), ".uploads");

// Tolak key yang mencoba keluar dari LOCAL_ROOT (path traversal).
function localPathFor(key: string): string | null {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (resolved !== LOCAL_ROOT && !resolved.startsWith(LOCAL_ROOT + path.sep)) {
    return null;
  }
  return resolved;
}

function createLocalStorage(): Storage {
  return {
    backend: "local",
    async put(key, bytes) {
      const file = localPathFor(key);
      if (!file) throw new Error("Invalid storage key.");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    },
    async delete(key) {
      const file = localPathFor(key);
      if (!file) return;
      await fs.rm(file, { force: true });
    },
    async serve(key) {
      const file = localPathFor(key);
      if (!file) return null;
      try {
        const buf = await fs.readFile(file);
        return { kind: "stream", bytes: new Uint8Array(buf), contentType: contentTypeForKey(key) };
      } catch {
        return null;
      }
    },
    async read(key) {
      const file = localPathFor(key);
      if (!file) return null;
      try {
        const buf = await fs.readFile(file);
        return { bytes: new Uint8Array(buf), contentType: contentTypeForKey(key) };
      } catch {
        return null;
      }
    },
  };
}

// Pilih backend sekali, berdasarkan env.
let _storage: Storage | null = null;
export function getStorage(): Storage {
  if (_storage) return _storage;
  const cfg = r2Config();
  // KRITIS (audit pra-deploy): disk lokal Railway BERSIFAT SEMENTARA — file hilang tiap
  // redeploy. Kalau R2 tak terkonfigurasi lengkap (termasuk salah ketik satu env), dulu
  // jatuh diam-diam ke disk & foto lenyap tanpa error. Di produksi kini GAGAL KERAS.
  if (!cfg && process.env.NODE_ENV === "production") {
    throw new Error(
      "R2 tidak terkonfigurasi lengkap (butuh R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY) — storage disk lokal tidak aman di produksi (file hilang saat " +
        "redeploy). Set kredensial R2."
    );
  }
  _storage = cfg ? createR2Storage(cfg) : createLocalStorage();
  console.log(`[storage] backend aktif: ${_storage.backend}`);
  return _storage;
}
