import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import PastQueueList from './PastQueueList.jsx';

// Reverse-chronological list of served Reading Path cards below
// today's card on /today. Parallel to PastConnections — same shape,
// different card_type. Both delegate rendering + collapse-toggle to
// PastQueueList so the two archives behave identically.

export default function PastReadingPaths({ excludeQueueId }) {
  const { data: items } = useQuery({
    queryKey: ['today', 'reading-paths'],
    queryFn: async () => (await api.getPastReadingPaths())?.readingPaths || [],
  });

  if (items == null) return null;
  const filtered = excludeQueueId
    ? items.filter(c => c.queue_id !== excludeQueueId)
    : items;

  return (
    <PastQueueList
      items={filtered}
      title="Past paths"
      subtitle="Reading sequences from previous days. Re-read, re-grade."
    />
  );
}
