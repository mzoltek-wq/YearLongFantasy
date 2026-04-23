import { notFound } from "next/navigation";

import { OwnerRoster } from "@/components/owners/owner-roster";
import { getOwnerSnapshot } from "@/lib/draft/service";

export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await getOwnerSnapshot(id);

  if (!snapshot) {
    notFound();
  }

  return <OwnerRoster ownerId={id} />;
}
