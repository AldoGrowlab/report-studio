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
    { label: "Tema bulanan", href: "/dashboard/theme" },
    { label: "Dashboard flag", href: "/dashboard/flags" },
    { label: "Generate report", href: "/dashboard/reports" },
    { label: "Kelola user", href: "/dashboard/users" },
  ];
  const userMenu = [
    { label: "Generate report", href: "/dashboard/reports" },
  ];
  const menu = isFounder ? founderMenu : userMenu;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line-2 bg-surface text-xs font-semibold tracking-tight text-fg">
              RS
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Report Studio</h1>
              <p className="mt-0.5 text-xs text-fg-3">
                <span className="text-fg-2">{session.email}</span>
                <span
                  className={`badge ml-2 ${isFounder ? "bg-accent/15 text-accent-hi" : "bg-ok/15 text-ok"}`}
                >
                  {isFounder ? "Founder" : "Operator"}
                </span>
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>

        <p className="label-sm mt-10">Menu</p>
        <div className="mt-3 grid gap-2.5">
          {menu.map((item) => (
            <a
              key={item.label}
              href={item.href ?? undefined}
              className={`card group flex items-center justify-between px-5 py-4 text-sm font-medium text-fg-2 ${
                item.href ? "card-hover cursor-pointer hover:text-fg" : "cursor-default opacity-60"
              }`}
            >
              {item.label}
              {item.href ? (
                <span
                  aria-hidden
                  className="text-fg-3 transition-colors duration-150 group-hover:text-accent"
                >
                  →
                </span>
              ) : (
                <span className="text-xs text-fg-3">segera</span>
              )}
            </a>
          ))}
        </div>

        <p className="mt-10 text-xs text-fg-3">
          {isFounder
            ? "Kamu melihat menu founder lengkap."
            : "Kamu melihat menu operator (hanya generate report)."}
        </p>
      </div>
    </div>
  );
}
