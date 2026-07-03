import { useState, useRef } from 'react';
import { api } from '../../../api.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Section } from '../shared.jsx';
import GoalCard from '../GoalCard.jsx';

// Reading goals: daily pages, yearly pages, yearly books. Owns its own
// settings fetch so a slow or failing /api/settings call doesn't gate
// the rest of Stats — a fetch failure here surfaces inline above the
// row instead of replacing the whole page.
export default function Goals({ todayPages, thisYearPages, thisYearBooks }) {
  const queryClient = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
    placeholderData: (prev) => prev ?? {},
  });
  const settings      = settingsQ.data ?? {};
  const settingsError = settingsQ.error;
  const setSettings = (updater) => {
    queryClient.setQueryData(
      ['settings'],
      (prev) => (typeof updater === 'function' ? updater(prev ?? {}) : updater),
    );
  };
  // Separate from the load-time error: this only surfaces when a goal
  // save round-trips a failure that we then rolled back optimistically.
  const [actionError, setActionError] = useState(null);
  // Bumped per goal-key on every saveGoal so an earlier failed save's
  // rollback can detect that a later edit on the same key has already
  // applied — without this, A's catch restores `prev` (A's pre-A value)
  // over B's newer optimistic value. Object keyed by goal name because
  // the three goals are independent, and a stale rollback on one
  // shouldn't drop a valid rollback on another. Mirrors the seq guard
  // used in Readlist / ListDetail / ShelfView / ShelfManager / rating
  // saves.
  const goalSaveSeqRef = useRef({});

  async function saveGoal(key, value) {
    const prev = settings[key];
    setActionError(null);
    setSettings(s => ({ ...s, [key]: String(value) }));
    const seq = goalSaveSeqRef.current[key] = (goalSaveSeqRef.current[key] ?? 0) + 1;
    try {
      await api.setSetting(key, value);
    } catch {
      if (seq !== goalSaveSeqRef.current[key]) return;
      setSettings(s => ({ ...s, [key]: prev }));
      setActionError('Failed to save goal.');
    }
  }

  return (
    <Section title="Goals">
      {settingsError && <p role="alert" className="text-xs text-warn mb-2">Failed to load goals.</p>}
      {actionError && <p role="alert" className="text-xs text-warn mb-2">{actionError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GoalCard
          label="Pages today"
          current={todayPages}
          goal={settings.daily_pages_goal ? parseInt(settings.daily_pages_goal) : 0}
          onSave={v => saveGoal('daily_pages_goal', v)}
          onEditStart={() => setActionError(null)}
          color="bg-oak"
        />
        <GoalCard
          label={`Pages in ${new Date().getFullYear()}`}
          current={thisYearPages}
          goal={settings.yearly_pages_goal ? parseInt(settings.yearly_pages_goal) : 0}
          onSave={v => saveGoal('yearly_pages_goal', v)}
          onEditStart={() => setActionError(null)}
          color="bg-oak"
        />
        <GoalCard
          label={`Books in ${new Date().getFullYear()}`}
          current={thisYearBooks}
          goal={settings.yearly_books_goal ? parseInt(settings.yearly_books_goal) : 0}
          onSave={v => saveGoal('yearly_books_goal', v)}
          onEditStart={() => setActionError(null)}
          color="bg-leather"
        />
      </div>
    </Section>
  );
}
