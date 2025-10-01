CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    school TEXT,
    major TEXT,
    grad_year INTEGER
);

CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    target_company TEXT,
    target_year TEXT -- 'freshman'|'sophomore'|'junior'|'senior'
);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, -- hash(url)
    url TEXT UNIQUE,
    domain TEXT,
    fetched_at TEXT, -- ISO8601
    status TEXT -- 'queued'|'fetched'|'parsed'|'embedded'
);

CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY, -- hash(url)
    url TEXT,
    school TEXT,
    degree TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    candidate_id TEXT,
    role TEXT,
    org TEXT,
    start_iso TEXT,
    end_iso TEXT,
    acad_year TEXT,
    ord INTEGER -- sequence order
);

CREATE INDEX IF NOT EXISTS idx_events_cand ON events (candidate_id, ord);