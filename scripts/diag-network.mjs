// Diagnostik jaringan SEMENTARA (Tahap 11) — dijalankan di dalam container Railway saat
// start, untuk membuktikan kenapa `postgres.railway.internal` tak terjangkau.
// Private networking Railway = IPv6-only. Skrip ini memisahkan tiga kemungkinan:
//   (a) container tak punya IPv6 -> private networking mustahil
//   (b) DNS tak mengembalikan AAAA -> masalah resolusi nama
//   (c) DNS oke tapi TCP gagal -> DB tak listen / beda jaringan / firewall
// TIDAK menampilkan kredensial: hanya host & port yang dicetak.
import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";

const raw = process.env.DATABASE_URL || "";
let host = "";
let port = 5432;
try {
  const u = new URL(raw);
  host = u.hostname;
  port = Number(u.port || 5432);
} catch {
  console.log("[diag] DATABASE_URL tidak bisa di-parse (kosong / bukan URL valid)");
}

console.log("========== DIAGNOSTIK JARINGAN RAILWAY ==========");
console.log("[diag] host target :", host || "(kosong)");
console.log("[diag] port target :", port);
console.log("[diag] node version:", process.version);

// (a) Apakah container punya alamat IPv6 non-loopback?
const found = [];
for (const [name, list] of Object.entries(os.networkInterfaces())) {
  for (const a of list || []) {
    found.push(`${name} ${a.family} ${a.address}${a.internal ? " (loopback)" : ""}`);
  }
}
console.log("[diag] --- alamat container ---");
found.forEach((f) => console.log("[diag]   " + f));
const hasGlobalV6 = (os.networkInterfaces
  ? Object.values(os.networkInterfaces()).flat()
  : []
).some((a) => a && a.family === "IPv6" && !a.internal);
console.log("[diag] punya IPv6 non-loopback:", hasGlobalV6 ? "YA ✓" : "TIDAK ❌ (private networking mustahil)");

if (host) {
  // (b) DNS: AAAA (IPv6) & A (IPv4)
  try {
    const v6 = await dns.resolve6(host);
    console.log("[diag] resolve6 (AAAA):", JSON.stringify(v6), "✓");
  } catch (e) {
    console.log("[diag] resolve6 (AAAA): GAGAL —", e.code || e.message);
  }
  try {
    const v4 = await dns.resolve4(host);
    console.log("[diag] resolve4 (A):", JSON.stringify(v4));
  } catch (e) {
    console.log("[diag] resolve4 (A): GAGAL —", e.code || e.message, "(wajar: internal Railway IPv6-only)");
  }
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    console.log("[diag] lookup(all):", JSON.stringify(all));
  } catch (e) {
    console.log("[diag] lookup: GAGAL —", e.code || e.message);
  }

  // (c) TCP connect ke port DB
  const tryConnect = (family) =>
    new Promise((resolve) => {
      const label = family === 6 ? "IPv6" : "auto";
      const sock = net.connect({ host, port, family: family || undefined, timeout: 8000 });
      sock.on("connect", () => {
        console.log(`[diag] TCP ${label} -> ${host}:${port} : TERBUKA ✓`);
        sock.destroy();
        resolve(true);
      });
      sock.on("timeout", () => {
        console.log(`[diag] TCP ${label} -> ${host}:${port} : TIMEOUT ❌`);
        sock.destroy();
        resolve(false);
      });
      sock.on("error", (e) => {
        console.log(`[diag] TCP ${label} -> ${host}:${port} : GAGAL — ${e.code || e.message}`);
        resolve(false);
      });
    });
  await tryConnect(6);
  await tryConnect(0);
}
console.log("========== DIAGNOSTIK SELESAI ==========");
