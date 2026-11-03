import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesignPreview } from './preview';

export const metadata: Metadata = { title: 'Design preview' };

function designPreviewEnabled() {
  return (
    process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW === '1'
  );
}

export default function DesignPreviewPage() {
  if (!designPreviewEnabled()) {
    notFound();
  }
  return <DesignPreview />;
}
