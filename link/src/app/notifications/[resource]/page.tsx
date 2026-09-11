import Console from './view';
import { notFound } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!['jobs', 'templates', 'deeplinks', 'deliveries'].includes(resource)) notFound();
  return <Console resource={resource} />;
}
