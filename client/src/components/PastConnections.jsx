import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PastQueueList from './PastQueueList.jsx';

// Reverse-chronological list of served Connection cards below today's
// card on /today. The shared PastQueueList shell handles rendering +
// collapse-toggle; this wrapper handles the fetch and the
// excludeQueueId filter (hides today's connection from the archive
// when it's already showing above as today's card).

export default function PastConnections({ excludeQueueId }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getPastConnections()
      .then(d => { if (!cancelled) setItems(d?.connections || []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

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
