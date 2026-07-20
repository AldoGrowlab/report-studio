import { redirect } from "next/navigation";
import ChangePasswordCard from "./ChangePasswordCard";
import { getSession } from "@/lib/session";
import LogoutButton from "./LogoutButton";

// Ikon garis sederhana (non-interaktif, currentColor) — warnanya diatur pemanggil.
function MenuIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    layers: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3c3 1.5 6 2 8 2 0 9-3.5 14-8 16-4.5-2-8-7-8-16 2 0 5-.5 8-2Z" />
        <path d="m9 11.5 2 2 4-4.5" />
      </>
    ),
    palette: (
      <>
        <path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.5c.5.7 0 2.5-2.5 2.5Z" />
        <circle cx="8" cy="10" r="0.6" />
        <circle cx="12" cy="7.5" r="0.6" />
        <circle cx="16" cy="10" r="0.6" />
      </>
    ),
    flag: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4c4-2 7 2 11 0v9c-4 2-7-2-11 0" />
      </>
    ),
    report: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v4h4" />
        <path d="M9 13h6M9 17h4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8.5" r="3" />
        <path d="M3.5 20c.7-3.2 3-5 5.5-5s4.8 1.8 5.5 5" />
        <path d="M16 6.5a3 3 0 0 1 0 5.6M17.5 15.5c1.6.8 2.7 2.3 3 4.5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      {paths[name]}
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const isFounder = session.role === "founder";

  // Tiap menu punya warna sendiri supaya ikon lebih hidup (warna = boleh diubah, sesuai izin).
  const founderMenu = [
    {
      label: "Section & KB",
      href: "/dashboard/sections",
      icon: "layers",
      color: "#5E8BFF",
      desc: "Kelola section, KB analisa, dan metrik tiap platform.",
    },
    {
      label: "KB Validator",
      href: "/dashboard/validator-kb",
      icon: "shield",
      color: "#34D399",
      desc: "Aturan merangkai narasi dan menulis kesimpulan.",
    },
    {
      label: "Tema bulanan",
      href: "/dashboard/theme",
      icon: "palette",
      color: "#F5B84C",
      desc: "Warna, font, logo, dan kontak untuk PPT.",
    },
    {
      label: "Dashboard flag",
      href: "/dashboard/flags",
      icon: "flag",
      color: "#F87171",
      desc: "Pantau flag lintas report — alat mempertajam KB.",
    },
    {
      label: "Generate report",
      href: "/dashboard/reports",
      icon: "report",
      color: "#A78BFA",
      desc: "Buat report, unggah screenshot, hasilkan insight & PPT.",
    },
    {
      label: "Kelola user",
      href: "/dashboard/users",
      icon: "users",
      color: "#22D3EE",
      desc: "Tambah akun founder dan operator tim.",
    },
  ];
  const userMenu = [
    {
      label: "Generate report",
      href: "/dashboard/reports",
      icon: "report",
      color: "#A78BFA",
      desc: "Buat report, unggah screenshot, hasilkan insight & PPT.",
    },
  ];
  const menu = isFounder ? founderMenu : userMenu;

  return (
    <div className="min-h-screen bg-ink text-fg">
      {/* Header ringkas selebar layar dengan garis hairline bawah */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-surface text-xs font-semibold tracking-tight text-fg">
              RS
            </div>
            <span className="text-base font-semibold tracking-tight">Report Studio</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-fg-2 sm:block">{session.email}</span>
            <span
              className={`badge text-sm ${isFounder ? "bg-accent/15 text-accent-hi" : "bg-ok/15 text-ok"}`}
            >
              {isFounder ? "Founder" : "Operator"}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">
          {isFounder ? "Kendali penuh studio" : "Mulai kerjakan report"}
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          {isFounder
            ? "Kamu melihat menu founder lengkap."
            : "Kamu melihat menu operator (hanya generate report)."}
        </p>

        {/* Grid kartu menu — lebih compact (gap & padding rapat), ikon berwarna */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {menu.map((item) => (
            <a
              key={item.label}
              href={item.href ?? undefined}
              className={`card group flex items-start gap-3.5 p-4 ${item.href ? "card-lift cursor-pointer" : "cursor-default opacity-60"}`}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{
                  color: item.color,
                  background: `color-mix(in srgb, ${item.color} 16%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${item.color} 30%, transparent)`,
                }}
              >
                <MenuIcon name={item.icon} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-medium text-fg">{item.label}</span>
                  <span
                    aria-hidden
                    className="text-fg-3 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
                  >
                    →
                  </span>
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-fg-2">{item.desc}</p>
              </div>
            </a>
          ))}
        </div>

        <ChangePasswordCard userId={session.userId} />
      </main>
    </div>
  );
}
