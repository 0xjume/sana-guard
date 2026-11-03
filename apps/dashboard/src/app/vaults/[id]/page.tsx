import { notFound } from 'next/navigation';
import { VaultDetail } from '@/components/vault-detail';
import { parseVaultId } from '@/lib/vault-id';
import { loadVaultSnapshot, serializeVaultSnapshot } from '@/lib/vault-snapshot';

export default async function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vaultId = parseVaultId(id);
  if (vaultId === null) {
    notFound();
  }

  // Fetch-cached 15s for a fast first paint. VaultDetail always refreshes
  // uncached after hydration so a reload after an owner action is not stale.
  const snapshot = await loadVaultSnapshot(vaultId, { revalidate: 15 });
  if (snapshot.status === 'not_found') {
    notFound();
  }

  return <VaultDetail vaultId={vaultId} initialSnapshot={serializeVaultSnapshot(snapshot)} />;
}
