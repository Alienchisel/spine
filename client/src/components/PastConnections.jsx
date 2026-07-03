import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import PastQueueList from './PastQueueList.jsx';

// Reverse-chronological list of served Connection cards below today's
// card on /today. The shared PastQueueList shell handles rendering +
// collapse-toggle; this wrapper handles the fetch and the
// excludeQueueId filter (hides today's connection from the archive
// when it's already showing above as today's card).

export default function PastConnections({ excludeQueueId }) {
  const { data: items } = useQuery({
    queryKey: ['today', 'connections'],
    queryFn: async () => (await api.getPastConnections())?.connections || [],
  });

  if (items == null) return null;
  const filtered = excludeQueueId
    ? items.filter(c => c.queue_id !== excludeQueueId)
    : items;

  return (
    <PastQueueList
      items={filtered}
      title="Past connections"
      subtitle="Threads from previous days. Re-read, re-grade."
    />
  );
}
