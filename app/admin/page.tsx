import { AdminPanel } from "@/components/admin/admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <AdminPanel
      feedback={{
        status: resolvedSearchParams.status,
        message: resolvedSearchParams.message,
      }}
    />
  );
}
