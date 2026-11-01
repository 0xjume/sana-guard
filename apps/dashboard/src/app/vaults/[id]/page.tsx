'use client';

import { useParams } from 'next/navigation';
import { VaultDetail } from '@/components/vault-detail';
import { Card, CardContent } from '@/components/ui/card';

export default function VaultPage() {
  const params = useParams<{ id: string }>();
  const vaultId = Number(params.id);
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-rejected">Invalid vault id.</CardContent>
      </Card>
    );
  }
  return <VaultDetail vaultId={vaultId} />;
}
