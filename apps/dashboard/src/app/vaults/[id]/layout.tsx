import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? `Vault ${id}` : 'Vault' };
}

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return children;
}
