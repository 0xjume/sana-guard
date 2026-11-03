import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parseVaultId, vaultPageTitle } from '@/lib/vault-id';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (parseVaultId(id) === null) {
    notFound();
  }
  return { title: vaultPageTitle(id) };
}

/**
 * Validate the id here. Home `loading.tsx` lives in `(home)/` so this layout
 * is not inside a parent Suspense stream, and this file is outside
 * `loading.tsx`'s page boundary. Non-canonical / overflow ids return a real
 * 404. Missing-but-canonical vaults still resolve in page.tsx after the
 * on-chain read (those may briefly stream the vault loading UI).
 */
export default async function VaultLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (parseVaultId(id) === null) {
    notFound();
  }
  return children;
}
