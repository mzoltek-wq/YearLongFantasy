import { ReactNode } from "react";

import { cn } from "@/lib/utils/format";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm", className)}>
      {children}
    </section>
  );
}
