import { KeeperWorkspace } from "@/components/keepers/keeper-workspace";

export const dynamic = "force-dynamic";

export default async function KeepersPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <KeeperWorkspace
      feedback={{
        status: resolvedSearchParams.status,
        message: resolvedSearchParams.message,
      }}
    />
  );
}
