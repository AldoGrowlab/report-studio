import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LogoutButton from "./LogoutButton";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const isFounder = session.role === "founder";

  const founderMenu = [
    { label: "Section & KB", href: "/dashboard/sections" },
    { label: "KB Validator", href: "/dashboard/validator-kb" },
    { label: "Tema bulanan", href: null },
    { label: "Dashboard flag", href: null },
    { label: "Generate report", href: "/dashboard/reports" },
    { label: "Kelola user", href: "/dashboard/users" },
  ];
  const userMenu = [
    { label: "Generate report", href: "/dashboard/reports" },
  ];
  const menu = isFounder ? founderMenu : userMenu;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Report Studio</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Masuk sebagai <span className="text-neutral-200">{session.email}</span>{" "}
              <span className={`ml-1 rounded px-2 py-0.5 text-xs font-medium ${isFounder ? "bg-blue-500/15 text-blue-300" : "bg-teal-500/15 text-teal-300"}`}>
                {isFounder ? "Founder" : "Operator"}
              </span>
            </p>
          </div>
          <LogoutButton />
        </div>

        <div className="mt-8 grid gap-3">
          {menu.map((item) => (
            <a
              key={item.label}
              href={item.href ?? undefined}
              className={`flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 text-sm font-medium text-neutral-200 ${
                item.href ? "hover:border-neutral-700 hover:bg-neutral-800 cursor-pointer" : "cursor-default opacity-60"
              }`}
            >
              {item.label}
              {!item.href && <span className="text-xs text-neutral-500">segera</span>}
            </a>
          ))}
        </div>

        <p className="mt-8 text-xs text-neutral-500">
          {isFounder
            ? "Kamu melihat menu founder lengkap."
            : "Kamu melihat menu operator (hanya generate report)."}
        </p>
      </div>
    </div>
  );
}
