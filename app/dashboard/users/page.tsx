"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type UserRow = {
  id: string;
  email: string;
  role: "founder" | "user";
  createdAt: string;
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "founder">("user");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Audit P1 — hapus akun (offboarding). Pesan per-baris + cegah klik ganda.
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  async function handleDelete(u: UserRow) {
    if (
      !window.confirm(
        `Hapus akun ${u.email}? Akun ini tidak bisa login lagi. Tindakan tidak bisa dibatalkan.`
      )
    ) {
      return;
    }
    setDeleting((p) => ({ ...p, [u.id]: true }));
    setRowError((p) => ({ ...p, [u.id]: "" }));
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setRowError((p) => ({ ...p, [u.id]: data.error || "Gagal menghapus." }));
        return;
      }
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch {
      setRowError((p) => ({ ...p, [u.id]: "Kesalahan jaringan." }));
    } finally {
      setDeleting((p) => ({ ...p, [u.id]: false }));
    }
  }

  // Refresh dari handler (buat user) — call site menyetel loading dulu.
  async function loadUsers() {
    const res = await fetch("/api/users");
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setUsers(data.users || []);
    setLoadingList(false);
  }

  // Muat awal di-inline (bukan panggil loadUsers): lint set-state-in-effect menandai
  // fungsi lokal ber-setState yang dipanggil dari efek; inline membuat jelas setState
  // terjadi SETELAH await (asinkron), bukan sinkron di badan efek.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/users");
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setUsers(data.users || []);
      setLoadingList(false);
    })();
  }, [router]);

  async function handleCreate() {
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal membuat user.");
        setSubmitting(false);
        return;
      }
      setSuccess(`User ${data.user.email} berhasil dibuat.`);
      setEmail("");
      setPassword("");
      setRole("user");
      setSubmitting(false);
      setLoadingList(true);
      loadUsers();
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Kembali ke dashboard
        </button>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Kelola user</h1>
        <p className="mt-1.5 text-sm text-fg-3">
          Buat akun baru untuk operator atau founder. Akun yang dibuat bisa langsung login.
        </p>

        <div className="mt-7 grid items-start gap-6 lg:grid-cols-5">
        {/* Form tambah user */}
        <div className="card p-6 lg:col-span-2">
          <h2 className="label-sm">Tambah user baru</h2>
          <div className="mt-4 grid gap-4">
            <div>
              <label className="label-sm mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input w-full"
                placeholder="operator@contoh.com"
              />
            </div>
            <div>
              <label className="label-sm mb-1.5 block">Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="minimal 6 karakter"
              />
            </div>
            <div>
              <label className="label-sm mb-1.5 block">Peran</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "user" | "founder")}
                className="input w-full"
              >
                <option value="user">Operator</option>
                <option value="founder">Founder</option>
              </select>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {success && <p className="mt-3 text-sm text-ok">{success}</p>}

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="mt-4 btn-primary px-4 py-2.5"
          >
            {submitting ? "Membuat…" : "Buat user"}
          </button>
        </div>

        {/* Daftar user */}
        <div className="lg:col-span-3">
          <h2 className="label-sm">Daftar user</h2>
          {loadingList ? (
            <p className="mt-3 text-sm text-fg-3">Memuat…</p>
          ) : (
            <div className="mt-3 card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60 text-fg-3">
                  <tr>
                    <th className="label-sm px-4 py-3 text-left">Email</th>
                    <th className="label-sm px-4 py-3 text-left">Peran</th>
                    <th className="label-sm px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-line align-top">
                      <td className="px-4 py-2.5 text-fg-2">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge ${u.role === "founder" ? "bg-accent/15 text-accent-hi" : "bg-ok/15 text-ok"}`}>
                          {u.role === "founder" ? "Founder" : "Operator"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={deleting[u.id]}
                          className="btn-danger px-2.5 py-1 text-xs"
                        >
                          {deleting[u.id] ? "Menghapus…" : "Hapus"}
                        </button>
                        {rowError[u.id] && (
                          <p className="mt-1 text-[10px] text-danger">{rowError[u.id]}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}