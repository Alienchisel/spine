-- Today card queue — storage for the manually-generated Connection
-- candidates. Connections are AI-shaped content (cross-author thematic
-- threads, the Howard ↔ Spengler shape) generated in chat with Claude
-- in batches and seeded into the queue. The Today server picks one
-- when the seeded rotation lands on type='connection'; subsequent days
-- pick the next unserved candidate.
--
-- No API call ever happens server-side. The queue is filled by a chat
-- conversation. This lets us ship the feature without the SDK in
-- production, without API key handling, without rate limits, without
-- cost engineering. When the queue runs low, regenerate in chat.
--
-- Feedback fields (feedback, feedback_at) capture the user's post-hoc
-- read of each card — Signal / Knew / Reaching. The next batch
-- generation reads recent feedback as few-shot examples ("here are
-- connections this user marked as signal — generate more like them")
-- without any fine-tuning loop.

CREATE TABLE IF NOT EXISTS today_card_queue (
  id           INTEGER PRIMARY KEY,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,    -- markdown with [#NNN](spine-book:NNN) book refs
  generated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  served_at    TEXT,                -- when the card first surfaced on /today
  served_date  TEXT,                -- YYYY-MM-DD the user saw it
  feedback     TEXT,                -- 'signal' | 'knew' | 'reaching' | NULL
  feedback_at  TEXT                 -- when the user graded it
);

-- Partial index for the hot path: picking the next unserved card.
CREATE INDEX IF NOT EXISTS idx_today_card_queue_unserved
  ON today_card_queue(id) WHERE served_at IS NULL;
