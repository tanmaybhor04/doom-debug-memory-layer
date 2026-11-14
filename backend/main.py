import re
import sqlite3
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="DOOM // Universal Memory Layer API", version="1.0.0")

# Allow React (5173/5174) and Chrome Extension to talk to localhost:8000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "doom_memory.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL,
            category TEXT DEFAULT 'Custom',
            scope TEXT DEFAULT 'global',
            project TEXT,
            enabled INTEGER DEFAULT 1,
            redactions INTEGER DEFAULT 0,
            updated_at TEXT NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS memory_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER,
            key TEXT,
            old_value TEXT,
            changed_at TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            platform TEXT,
            project TEXT,
            memory_count INTEGER,
            tokens INTEGER,
            prompt_chars INTEGER
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            k TEXT PRIMARY KEY,
            v TEXT
        )
    """)
    conn.commit()
    conn.close()


init_db()

# ── Secret / PII Redactor ────────────────────────────────────────────────────
SECRET_PATTERNS = [
    (r"sk-[a-zA-Z0-9_-]{12,}", "[REDACTED_API_KEY]"),
    (r"ghp_[a-zA-Z0-9]{16,}", "[REDACTED_GITHUB_TOKEN]"),
    (r"AKIA[0-9A-Z]{16}", "[REDACTED_AWS_KEY]"),
    (r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "[REDACTED_EMAIL]"),
]


def scrub_text(text: str):
    counts = {}
    cleaned = text
    for pattern, replacement in SECRET_PATTERNS:
        matches = re.findall(pattern, cleaned)
        if matches:
            counts[replacement] = len(matches)
            cleaned = re.sub(pattern, replacement, cleaned)
    return cleaned, counts


# ── Schemas ──────────────────────────────────────────────────────────────────
class MemoryIn(BaseModel):
    key: str
    value: str
    category: Optional[str] = "Custom"
    scope: Optional[str] = "global"
    project: Optional[str] = None
    enabled: Optional[bool] = True


class MemoryPatch(BaseModel):
    key: Optional[str] = None
    value: Optional[str] = None
    category: Optional[str] = None
    scope: Optional[str] = None
    project: Optional[str] = None
    enabled: Optional[bool] = None


class ResolveIn(BaseModel):
    prompt: str = ""
    platform: str = "unknown"
    conversation_is_new: bool = True
    force: bool = False
    dry_run: bool = False


class ProjectSet(BaseModel):
    name: Optional[str] = None


class ImportIn(BaseModel):
    memories: List[Dict[str, Any]]


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) AS c FROM memories WHERE enabled = 1").fetchone()["c"]
    conn.close()
    return {
        "status": "ok",
        "version": "v1.0",
        "memories": count,
        "mode": "local_unified",
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/memories")
def list_memories():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM memories ORDER BY id DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["enabled"] = bool(d["enabled"])
        result.append(d)
    return result


@app.post("/memories", status_code=201)
def create_or_upsert_memory(body: MemoryIn):
    cleaned_val, redactions = scrub_text(body.value)
    redaction_total = sum(redactions.values())
    now = datetime.now(timezone.utc).isoformat()

    conn = get_conn()
    existing = conn.execute("SELECT * FROM memories WHERE key = ?", (body.key,)).fetchone()
    if existing:
        conn.execute(
            "INSERT INTO memory_history (memory_id, key, old_value, changed_at) VALUES (?, ?, ?, ?)",
            (existing["id"], existing["key"], existing["value"], now),
        )
        conn.execute(
            """UPDATE memories
               SET value = ?, category = ?, scope = ?, project = ?, enabled = ?, redactions = ?, updated_at = ?
               WHERE id = ?""",
            (cleaned_val, body.category, body.scope, body.project, int(body.enabled), redaction_total, now, existing["id"]),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (existing["id"],)).fetchone()
        conn.close()
        out = dict(row)
        out["upserted"] = True
        out["redacted"] = redactions
        print(f"\n🔄 UPDATED RULE -> {body.key}: {cleaned_val}\n")
        return out

    cur = conn.execute(
        """INSERT INTO memories (key, value, category, scope, project, enabled, redactions, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.key, cleaned_val, body.category, body.scope, body.project, int(body.enabled), redaction_total, now),
    )
    new_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM memories WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    out = dict(row)
    out["upserted"] = False
    out["redacted"] = redactions
    print(f"\n🔥 NEW RULE SAVED -> {body.key}: {cleaned_val}\n")
    return out


@app.put("/memories/{mem_id}")
def update_memory(mem_id: int, body: MemoryPatch):
    conn = get_conn()
    existing = conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
    if not existing:
        cfg = conn.execute("SELECT plan FROM workspace_config WHERE id = 1").fetchone()
        count = conn.execute("SELECT COUNT(*) AS c FROM memories").fetchone()["c"]
        if cfg and cfg["plan"] == "free" and count >= 3:
            conn.close()
            raise HTTPException(status_code=403, detail="Free Tier limit (3 rules) reached. Upgrade to Pro or Team in the Enterprise tab.")

    new_val = body.value if body.value is not None else existing["value"]
    cleaned_val, _ = scrub_text(new_val)
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """UPDATE memories SET key = ?, value = ?, category = ?, scope = ?, project = ?, enabled = ?, updated_at = ?
           WHERE id = ?""",
        (
            body.key if body.key is not None else existing["key"],
            cleaned_val,
            body.category if body.category is not None else existing["category"],
            body.scope if body.scope is not None else existing["scope"],
            body.project if body.project is not None else existing["project"],
            int(body.enabled) if body.enabled is not None else existing["enabled"],
            now,
            mem_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/memories/{mem_id}")
def delete_memory(mem_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
    conn.commit()
    conn.close()
    return {"deleted": True, "id": mem_id}


@app.get("/memories/{mem_id}/history")
def memory_history(mem_id: int):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM memory_history WHERE memory_id = ? ORDER BY id DESC", (mem_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/context/resolve")
def resolve_context(body: ResolveIn):
    conn = get_conn()
    active_proj_row = conn.execute("SELECT v FROM settings WHERE k = 'active_project'").fetchone()
    active_proj = active_proj_row["v"] if active_proj_row else None

    rows = conn.execute("SELECT * FROM memories WHERE enabled = 1 ORDER BY id DESC").fetchall()
    used = []
    for r in rows:
        d = dict(r)
        if d["scope"] == "global" or (d["scope"] == "project" and active_proj and d["project"] == active_proj):
            used.append(d)

    scrubbed_prompt, prompt_redactions = scrub_text(body.prompt)

    if not used:
        conn.close()
        return {"injected": False, "reason": "No active rules configured yet", "final_prompt": scrubbed_prompt}

    lines = "\n".join([f"- {m['key']}: {m['value']}" for m in used])
    context_block = f"[Context from my AI Memory Layer. Apply it where relevant.]\n{lines}\n[End of context]"
    final_prompt = f"{context_block}\n\n{scrubbed_prompt}" if scrubbed_prompt else context_block
    tokens = max(1, round(len(context_block) / 4))

    if not body.dry_run:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO audit_log (ts, platform, project, memory_count, tokens, prompt_chars)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (now, body.platform, active_proj or "global", len(used), tokens, len(body.prompt)),
        )
        conn.commit()
        print(f"⚡ INJECTED {len(used)} rules into {body.platform.upper()} ({tokens} tokens)")

    conn.close()
    return {
        "injected": True,
        "context_block": context_block,
        "final_prompt": final_prompt,
        "used": used,
        "token_estimate": tokens,
        "redactions": prompt_redactions,
    }


@app.get("/projects")
def get_projects():
    conn = get_conn()
    rows = conn.execute("SELECT DISTINCT project FROM memories WHERE project IS NOT NULL AND project != ''").fetchall()
    active_row = conn.execute("SELECT v FROM settings WHERE k = 'active_project'").fetchone()
    conn.close()
    return {
        "active": active_row["v"] if active_row else None,
        "projects": [r["project"] for r in rows],
    }


@app.put("/projects/active")
def set_active_project(body: ProjectSet):
    conn = get_conn()
    if body.name:
        conn.execute("INSERT OR REPLACE INTO settings (k, v) VALUES ('active_project', ?)", (body.name,))
    else:
        conn.execute("DELETE FROM settings WHERE k = 'active_project'")
    conn.commit()
    conn.close()
    return get_projects()


@app.get("/audit")
def get_audit(limit: int = 10):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/stats")
def get_stats():
    conn = get_conn()
    total_mem = conn.execute("SELECT COUNT(*) AS c FROM memories").fetchone()["c"]
    enabled_mem = conn.execute("SELECT COUNT(*) AS c FROM memories WHERE enabled = 1").fetchone()["c"]
    inj_row = conn.execute("SELECT COUNT(*) AS c, COALESCE(AVG(tokens), 0) AS avg_t FROM audit_log").fetchone()
    conn.close()
    return {
        "memories": total_mem,
        "enabled": enabled_mem,
        "injections": inj_row["c"],
        "avg_tokens_per_injection": inj_row["avg_t"],
    }


@app.get("/export")
def export_all():
    return {"memories": list_memories()}


@app.post("/import")
def import_memories(body: ImportIn):
    for m in body.memories:
        if "key" in m and "value" in m:
            create_or_upsert_memory(MemoryIn(**m))
    return {"imported": len(body.memories)}

import secrets

# ── Initialize Monetization & Enterprise Governance Tables ───────────────────
def init_enterprise_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS workspace_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            plan TEXT DEFAULT 'free',
            workspace_name TEXT DEFAULT 'Core Engineering Workspace',
            strict_pii_lock INTEGER DEFAULT 1
        )
    """)
    cur.execute("INSERT OR IGNORE INTO workspace_config (id, plan, workspace_name, strict_pii_lock) VALUES (1, 'free', 'Core Engineering Workspace', 1)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT DEFAULT 'Developer',
            status TEXT DEFAULT 'Active',
            added_at TEXT NOT NULL
        )
    """)
    # Seed default team members if empty
    if cur.execute("SELECT COUNT(*) AS c FROM team_members").fetchone()["c"] == 0:
        now = datetime.now(timezone.utc).isoformat()
        cur.execute("INSERT INTO team_members (name, email, role, status, added_at) VALUES (?, ?, ?, ?, ?)",
                    ("Workspace Admin", "admin@doom-layer.dev", "Owner", "Active", now))
        cur.execute("INSERT INTO team_members (name, email, role, status, added_at) VALUES (?, ?, ?, ?, ?)",
                    ("Backend Lead", "backend@doom-layer.dev", "Admin", "Active", now))

    cur.execute("""
        CREATE TABLE IF NOT EXISTS enterprise_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            api_key TEXT UNIQUE NOT NULL,
            scope TEXT DEFAULT 'read:context,write:audit',
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

init_enterprise_db()


# ── Enterprise & Billing Schemas ─────────────────────────────────────────────
class PlanUpdateIn(BaseModel):
    plan: str  # 'free' | 'pro' | 'team' | 'enterprise'
    workspace_name: Optional[str] = None
    strict_pii_lock: Optional[bool] = None

class SeatInviteIn(BaseModel):
    name: str
    email: str
    role: str = "Developer"

class ApiKeyCreateIn(BaseModel):
    label: str
    scope: str = "read:context,write:audit"


# ── Enterprise, Team & Subscription Endpoints ────────────────────────────────
@app.get("/enterprise/overview")
def get_enterprise_overview():
    conn = get_conn()
    cfg = dict(conn.execute("SELECT * FROM workspace_config WHERE id = 1").fetchone())
    members = [dict(r) for r in conn.execute("SELECT * FROM team_members ORDER BY id ASC").fetchall()]
    keys = [dict(r) for r in conn.execute("SELECT * FROM enterprise_keys ORDER BY id DESC").fetchall()]
    rule_count = conn.execute("SELECT COUNT(*) AS c FROM memories").fetchone()["c"]
    redacted_count = conn.execute("SELECT COALESCE(SUM(redactions), 0) AS s FROM memories").fetchone()["s"]
    conn.close()

    plan_limits = {"free": 3, "pro": 999, "team": 999, "enterprise": 9999}
    max_rules = plan_limits.get(cfg["plan"], 3)

    return {
        "plan": cfg["plan"],
        "workspace_name": cfg["workspace_name"],
        "strict_pii_lock": bool(cfg["strict_pii_lock"]),
        "usage": {
            "current_rules": rule_count,
            "max_rules": max_rules,
            "seats_used": len(members),
            "seats_limit": 1 if cfg["plan"] in ("free", "pro") else (10 if cfg["plan"] == "team" else 100),
            "total_pii_redactions": redacted_count,
        },
        "members": members,
        "api_keys": keys,
    }


@app.put("/enterprise/plan")
def update_enterprise_plan(body: PlanUpdateIn):
    conn = get_conn()
    current = dict(conn.execute("SELECT * FROM workspace_config WHERE id = 1").fetchone())
    new_name = body.workspace_name if body.workspace_name is not None else current["workspace_name"]
    new_lock = int(body.strict_pii_lock) if body.strict_pii_lock is not None else current["strict_pii_lock"]

    conn.execute(
        "UPDATE workspace_config SET plan = ?, workspace_name = ?, strict_pii_lock = ? WHERE id = 1",
        (body.plan, new_name, new_lock),
    )
    conn.commit()
    conn.close()
    print(f"💳 WORKSPACE PLAN UPDATED -> {body.plan.upper()}")
    return get_enterprise_overview()


@app.post("/enterprise/seats", status_code=201)
def add_team_seat(body: SeatInviteIn):
    conn = get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO team_members (name, email, role, status, added_at) VALUES (?, ?, ?, 'Active', ?)",
        (body.name, body.email, body.role, now),
    )
    conn.commit()
    conn.close()
    return get_enterprise_overview()


@app.delete("/enterprise/seats/{seat_id}")
def remove_team_seat(seat_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM team_members WHERE id = ?", (seat_id,))
    conn.commit()
    conn.close()
    return get_enterprise_overview()


@app.post("/enterprise/keys", status_code=201)
def generate_enterprise_key(body: ApiKeyCreateIn):
    raw_token = f"doom_ent_{secrets.token_hex(12)}"
    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    conn.execute(
        "INSERT INTO enterprise_keys (label, api_key, scope, created_at) VALUES (?, ?, ?, ?)",
        (body.label, raw_token, body.scope, now),
    )
    conn.commit()
    conn.close()
    print(f"🔑 ISSUED ENTERPRISE API KEY -> {body.label} ({raw_token[:15]}...)")
    return get_enterprise_overview()


@app.delete("/enterprise/keys/{key_id}")
def revoke_enterprise_key(key_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM enterprise_keys WHERE id = ?", (key_id,))
    conn.commit()
    conn.close()
    return get_enterprise_overview()