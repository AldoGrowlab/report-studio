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

  async function loadUsers() {
    setLoadingList(true);
    const res = await fetch("/api/users");
    if (res.status === 403) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setUsers(data.users || []);
    setLoadingList(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

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
      loadUsers();
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Kembali ke dashboard
        </button>

        <h1 className="mt-4 text-2xl font-semibold">Kelola user</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Buat akun baru untuk operator atau founder. Akun yang dibuat bisa langsung login.
        </p>

        {/* Form tambah user */}
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-medium text-neutral-200">Tambah user baru</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="operator@contoh.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                placeholder="minimal 6 karakter"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Peran</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "user" | "founder")}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="user">Operator</option>
                <option value="founder">Founder</option>
              </select>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          {success && <p className="mt-3 text-sm text-teal-400">{success}</p>}

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Membuat…" : "Buat user"}
          </button>
        </div>

        {/* Daftar user */}
        <div className="mt-6">
          <h2 className="text-sm font-medium text-neutral-200">Daftar user</h2>
          {loadingList ? (
            <p className="mt-3 text-sm text-neutral-500">Memuat…</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Email</th>
                    <th className="px-4 py-2.5 text-left font-medium">Peran</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-neutral-800">
                      <td className="px-4 py-2.5 text-neutral-200">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${u.role === "founder" ? "bg-blue-500/15 text-blue-300" : "bg-teal-500/15 text-teal-300"}`}>
                          {u.role === "founder" ? "Founder" : "Operator"}
                        </span>
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
  );
}