'use client';

import { useParams } from 'next/navigation';
import { VaultDetail } from '@/components/vault-detail';

export default function VaultPage() {
  const params = useParams<{ id: string }>();
  const vaultId = Number(params.id);
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    return <section className="panel">Invalid vault id.</section>;
  }
  return <VaultDetail vaultId={vaultId} />;
}
