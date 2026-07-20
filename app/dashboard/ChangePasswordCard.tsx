"use client";

import { useState } from "react";

// Ganti password mandiri (Batch C). Sebelum ini tidak ada cara mengganti password sama
// sekali: operator yang passwordnya bocor/lupa harus minta founder, dan founder sendiri
// terjebak dengan password seed. Wajib password lama supaya sesi yang terlanjur bocor
// tidak bisa dipakai mengunci pemilik akun keluar dari akunnya sendiri.
export default function ChangePasswordCard({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCurrentPassword("");
    setPassword("");
    setConfirm("");
    setError("");
  }

  async function handleSave() {
    setError("");
    setOk("");
    if (password.length < 6) {
      setError("Password baru minimal 6 karakter.");
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Gagal mengganti password (kode ${res.status}).`);
        return;
      }
      reset();
      setOpen(false);
      setOk("Password berhasil diganti.");
    } catch {
      setError("Kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-8 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-fg">Password akun</h2>
          <p className="mt-0.5 text-sm text-fg-3">
            Ganti password login kamu sendiri.
          </p>
        </div>
        <button
          onClick={() => {
            setOk("");
            reset();
            setOpen((v) => !v);
          }}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          {open ? "Batal" : "Ganti password"}
        </button>
      </div>

      {ok && !open && <p className="mt-3 text-sm text-ok">{ok}</p>}

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Password lama"
            autoComplete="current-password"
            className="input w-full"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password baru (min. 6)"
            autoComplete="new-password"
            className="input w-full"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !saving && handleSave()}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            className="input w-full"
          />
          <div className="sm:col-span-3">
            {error && <p className="mb-2 text-sm text-danger">{error}</p>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary px-4 py-2 text-sm"
            >
              {saving ? "Menyimpan…" : "Simpan password baru"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
