-- User Websets table to store the relationship between users and their Exa Websets
CREATE TABLE IF NOT EXISTS user_websets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_url TEXT NOT NULL UNIQUE,
    linkedin_hash TEXT NOT NULL,
    webset_id TEXT NOT NULL,
    webset_external_id TEXT NOT NULL,
    user_school TEXT NOT NULL,
    user_major TEXT NOT NULL,
    user_grad_year INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT
);

-- Indices for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_websets_linkedin ON user_websets (linkedin_url);

CREATE INDEX IF NOT EXISTS idx_user_websets_webset_id ON user_websets (webset_id);

CREATE INDEX IF NOT EXISTS idx_user_websets_hash ON user_websets (linkedin_hash);

-- Table to store LinkedIn profile data
CREATE TABLE IF NOT EXISTS linkedin_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_url TEXT NOT NULL UNIQUE,
    full_name TEXT,
    headline TEXT,
    profile_data TEXT, -- JSON blob of parsed LinkedIn data
    extracted_at TEXT NOT NULL
);

-- Table to store user-specific career goals
CREATE TABLE IF NOT EXISTS user_career_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_url TEXT NOT NULL,
    target_role TEXT NOT NULL,
    target_company TEXT,
    target_industry TEXT,
    timeframe TEXT, -- e.g. "1 year", "5 years"
    priority INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (linkedin_url) REFERENCES user_websets (linkedin_url)
);
