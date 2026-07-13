import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

// Guard server halaman founder (audit pra-deploy Jul 2026): halaman ini client component,
// tanpa guard ini shell fitur founder ikut ter-render untuk operator (datanya memang 403,
// tapi fitur tak boleh terlihat). Non-founder dialihkan sebelum shell terkirim.
export default async function FounderOnlyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "founder") redirect("/dashboard");
  return children;
}
