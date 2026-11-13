"""SQLite setup. Uses only Python's built-in sqlite3 -> zero extra dependencies."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = os.getenv("MEMORY_DB_PATH", str(Path(__file__).parent / "memory_layer.db"))

SCHEMA = """
-- Individuals. plan = 'free' (limited) or 'pro' (unlimited)
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
    created_at    TEXT NOT NULL
);

-- Login sessions. We store only a HASH of the token, never the token itself.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Team workspaces (enterprise side). seat_limit = number of paid seats.
CREATE TABLE IF NOT EXISTS workspaces (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    seat_limit INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL
);

-- Who belongs to which workspace (each row = 1 seat used)
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at    TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

-- The "brain": one table for BOTH personal and workspace rules.
CREATE TABLE IF NOT EXISTS context_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    scope        TEXT NOT NULL CHECK (scope IN ('personal', 'workspace')),
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    title        TEXT NOT NULL,
    content      TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'general',
    priority     INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    CHECK (
        (scope = 'personal'  AND user_id IS NOT NULL AND workspace_id IS NULL) OR
        (scope = 'workspace' AND workspace_id IS NOT NULL AND user_id IS NULL)
    )
);

-- Usage + governance log. NEVER stores prompt text, only counts.
CREATE TABLE IF NOT EXISTS injection_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL,
    redaction_count INTEGER NOT NULL DEFAULT 0,
    day             TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_user      ON context_rules(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rules_workspace ON context_rules(workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_members_user    ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_log_user_day    ON injection_log(user_id, day);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row            # rows behave like dicts
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite ignores FKs unless you ask
    return conn


def init_db() -> None:
    conn = _connect()
    conn.execute("PRAGMA journal_mode = WAL")  # faster concurrent read/write
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def get_db():
    """FastAPI dependency: one connection per request, always closed."""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()
