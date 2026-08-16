"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { usePathname } from "next/navigation";

const links = [
  { href: "/draft", label: "Draft" },
  { href: "/keepers", label: "Draft Setup" },
  { href: "/league/2026/grid", label: "Draft History" },
  { href: "/rosters", label: "Rosters" },
  { href: "/trades", label: "Trades" },
  { href: "/admin", label: "Admin" },
  { href: "/tracker", label: "Tracker" },
  { href: "/league-view", label: "League View" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/tracker") || pathname.startsWith("/league-view")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[rgba(255,253,247,0.88)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--muted)]">Fantasy Keeper HQ</p>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Multi-sport fantasy keeper league control room</h1>
              <p className="max-w-3xl text-sm text-[var(--muted)]">
                Draft setup, live tracking, trade history, and league administration in one place.
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap gap-2">
            {links.map((link) => (
              <Link
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  pathname === link.href || pathname.startsWith(`${link.href}/`)
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
