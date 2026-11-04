import { notFound } from 'next/navigation';
import { VaultDetail } from '@/components/vault-detail';
import { parseVaultId } from '@/lib/vault-id';
import { loadVaultSnapshot, serializeVaultSnapshot } from '@/lib/vault-snapshot';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vaultId = parseVaultId(id);
  if (vaultId === null) {
    notFound();
  }

  const snapshot = await loadVaultSnapshot(vaultId);
  if (snapshot.status === 'not_found') {
    notFound();
  }

  return <VaultDetail vaultId={vaultId} initialSnapshot={serializeVaultSnapshot(snapshot)} />;
}
