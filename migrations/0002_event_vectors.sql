CREATE TABLE IF NOT EXISTS event_vectors (
  id TEXT PRIMARY KEY,           -- `${candidateId}:${ord}`
  candidate_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  vec BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_vectors_cand ON event_vectors(candidate_id, ord);

