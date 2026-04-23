import { ReactNode } from "react";

export default function TrackerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
