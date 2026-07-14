import { redirect } from "next/navigation";

// Audit P6: root "/" dulu masih halaman template create-next-app. Alihkan ke login
// (guard sesi & peran ada di /dashboard). Tidak ada tampilan sendiri.
export default function Home() {
  redirect("/login");
}
