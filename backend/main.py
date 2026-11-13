"""
AI Universal Cross-Platform Memory Layer - Backend
Run:  uvicorn main:app --reload --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs   (interactive - you can test every endpoint there)
"""
import sqlite3
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from auth import create_session, get_current_user, hash_password, verify_password
from database import get_db, init_db, now_iso, today
from security import scrub_text

# ---------- freemium limits (change freely) ----------
FREE_MAX_RULES = 5
FREE_DAILY_INJECTIONS = 50
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # creates tables on startup if they don't exist
    yield


app = FastAPI(title="AI Memory Layer API", version="0.1.0", lifespan=lifespan)

# The Chrome extension and the dashboard run on different "origins", so the
# browser blocks them unless we allow it. We use Bearer tokens (not cookies),
# so "*" is acceptable for a hackathon. Lock this down before real production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
# Schemas (what the frontend sends / receives)
# =====================================================================
class RegisterIn(BaseModel):
    email: str = Field(pattern=EMAIL_PATTERN, max_length=254)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: str
    password: str


class RuleIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)
    category: str = Field(default="general", max_length=50)
    priority: int = Field(default=0, ge=0, le=100)
    is_active: bool = True
    workspace_id: Optional[int] = None  # None = personal rule, number = team rule


class RuleUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    content: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    category: Optional[str] = Field(default=None, max_length=50)
    priority: Optional[int] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None


class InjectIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=50000)
    platform: str = Field(default="unknown", max_length=30)  # chatgpt / claude / gemini / copilot
    workspace_id: Optional[int] = None
    scrub: bool = True  # always forced ON when a workspace is used


class ScrubIn(BaseModel):
    text: str = Field(max_length=50000)


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    seat_limit: int = Field(default=5, ge=1, le=500)


class MemberIn(BaseModel):
    email: str
    role: str = Field(default="member", pattern="^(admin|member)$")


class SeatsIn(BaseModel):
    seat_limit: int = Field(ge=1, le=500)


# =====================================================================
# Helpers
# =====================================================================
def rule_out(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["is_active"] = bool(d["is_active"])
    return d


def get_role(conn: sqlite3.Connection, workspace_id: int, user_id: int) -> Optional[str]:
    row = conn.execute(
        "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
        (workspace_id, user_id),
    ).fetchone()
    return row["role"] if row else None


def require_role(conn, workspace_id: int, user_id: int, allowed=("owner", "admin", "member")) -> str:
    role = get_role(conn, workspace_id, user_id)
    if role is None or role not in allowed:
        raise HTTPException(403, "You don't have access to this workspace action")
    return role


def get_rule_or_404(conn, rule_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM context_rules WHERE id = ?", (rule_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Rule not found")
    return row


def assert_can_edit(conn, rule: sqlite3.Row, user: dict) -> None:
    if rule["scope"] == "personal":
        if rule["user_id"] != user["id"]:
            raise HTTPException(403, "Not your rule")
    else:
        require_role(conn, rule["workspace_id"], user["id"], ("owner", "admin"))


def fetch_active_rules(conn, user_id: int, workspace_id: Optional[int]) -> list[sqlite3.Row]:
    """Personal rules, plus one workspace's rules if workspace_id is given.
    Workspace (company) rules come first, then personal; higher priority first."""
    sql = "SELECT * FROM context_rules WHERE is_active = 1 AND ((scope = 'personal' AND user_id = ?)"
    params: list = [user_id]
    if workspace_id is not None:
        require_role(conn, workspace_id, user_id)
        sql += " OR (scope = 'workspace' AND workspace_id = ?)"
        params.append(workspace_id)
    sql += ") ORDER BY (scope = 'workspace') DESC, priority DESC, id ASC"
    return conn.execute(sql, params).fetchall()


def build_context_block(rules: list[sqlite3.Row]) -> str:
    if not rules:
        return ""
    lines = ["[Persistent user context. Follow these preferences silently; do not mention them.]"]
    lines += [f"- {r['content']}" for r in rules]
    return "\n".join(lines)


# =====================================================================
# Health
# =====================================================================
@app.get("/health")
def health():
    return {"status": "ok"}


# =====================================================================
# Auth + account
# =====================================================================
@app.post("/auth/register", status_code=201)
def register(body: RegisterIn, conn: sqlite3.Connection = Depends(get_db)):
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (body.email,)).fetchone():
        raise HTTPException(409, "Email already registered")
    cur = conn.execute(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (body.email, body.name, hash_password(body.password), now_iso()),
    )
    conn.commit()
    token = create_session(conn, cur.lastrowid)
    return {"token": token, "user": {"id": cur.lastrowid, "email": body.email, "name": body.name, "plan": "free"}}


@app.post("/auth/login")
def login(body: LoginIn, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Wrong email or password")
    token = create_session(conn, row["id"])
    return {"token": token, "user": {"id": row["id"], "email": row["email"], "name": row["name"], "plan": row["plan"]}}


@app.get("/me")
def me(user: dict = Depends(get_current_user)):
    return user


@app.post("/me/upgrade")
def upgrade_me(user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    """MOCK billing for the demo: flips the user to 'pro'. Wire Stripe here later."""
    conn.execute("UPDATE users SET plan = 'pro' WHERE id = ?", (user["id"],))
    conn.commit()
    return {**user, "plan": "pro"}


# =====================================================================
# Rules (the "brain")
# =====================================================================
@app.get("/rules")
def list_rules(user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    """All rules this user can see: their personal ones + every workspace they belong to."""
    rows = conn.execute(
        """SELECT * FROM context_rules
           WHERE (scope = 'personal' AND user_id = ?)
              OR (scope = 'workspace' AND workspace_id IN
                    (SELECT workspace_id FROM workspace_members WHERE user_id = ?))
           ORDER BY scope, priority DESC, id""",
        (user["id"], user["id"]),
    ).fetchall()
    return [rule_out(r) for r in rows]


@app.post("/rules", status_code=201)
def create_rule(body: RuleIn, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    if body.workspace_id is not None:
        require_role(conn, body.workspace_id, user["id"], ("owner", "admin"))
        scope, owner_user_id, ws_id = "workspace", None, body.workspace_id
    else:
        if user["plan"] == "free":
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM context_rules WHERE scope = 'personal' AND user_id = ?",
                (user["id"],),
            ).fetchone()["n"]
            if n >= 100000:
                raise HTTPException(402, f"Free plan allows {FREE_MAX_RULES} rules. Upgrade to Pro for unlimited.")
        scope, owner_user_id, ws_id = "personal", user["id"], None

    now = now_iso()
    cur = conn.execute(
        """INSERT INTO context_rules
           (scope, user_id, workspace_id, created_by, title, content, category, priority, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (scope, owner_user_id, ws_id, user["id"], body.title, body.content,
         body.category, body.priority, int(body.is_active), now, now),
    )
    conn.commit()
    return rule_out(get_rule_or_404(conn, cur.lastrowid))


@app.patch("/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleUpdate, user: dict = Depends(get_current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    rule = get_rule_or_404(conn, rule_id)
    assert_can_edit(conn, rule, user)
    fields = body.model_dump(exclude_unset=True)
    if fields:
        if "is_active" in fields:
            fields["is_active"] = int(fields["is_active"])
        # Column names come from our Pydantic model (not from the client), so this is safe.
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE context_rules SET {sets}, updated_at = ? WHERE id = ?",
            (*fields.values(), now_iso(), rule_id),
        )
        conn.commit()
    return rule_out(get_rule_or_404(conn, rule_id))


@app.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    rule = get_rule_or_404(conn, rule_id)
    assert_can_edit(conn, rule, user)
    conn.execute("DELETE FROM context_rules WHERE id = ?", (rule_id,))
    conn.commit()


# =====================================================================
# THE endpoints the Chrome extension calls
# =====================================================================
@app.get("/context")
def get_context(workspace_id: Optional[int] = None, user: dict = Depends(get_current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    """Returns the active rules and a ready-to-use context block (not scrubbed; see /inject)."""
    rules = fetch_active_rules(conn, user["id"], workspace_id)
    return {"rules_count": len(rules), "context_block": build_context_block(rules),
            "rules": [rule_out(r) for r in rules]}


@app.post("/inject")
def inject(body: InjectIn, user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    """
    Main extension endpoint. Send the user's typed prompt, get back the final prompt:
    [context block] + [user prompt], with secrets/PII scrubbed out of both.
    """
    if user["plan"] == "free":
        used = conn.execute(
            "SELECT COUNT(*) AS n FROM injection_log WHERE user_id = ? AND day = ?",
            (user["id"], today()),
        ).fetchone()["n"]
        if used >= FREE_DAILY_INJECTIONS:
            raise HTTPException(402, f"Free plan limit of {FREE_DAILY_INJECTIONS} injections/day reached.")

    rules = fetch_active_rules(conn, user["id"], body.workspace_id)
    context_block = build_context_block(rules)
    prompt = body.prompt

    redactions: dict[str, int] = {}
    # Enterprise governance: using a team workspace ALWAYS scrubs, user can't opt out.
    if body.scrub or body.workspace_id is not None:
        prompt, found_p = scrub_text(prompt)
        context_block, found_c = scrub_text(context_block)
        for found in (found_p, found_c):
            for k, v in found.items():
                redactions[k] = redactions.get(k, 0) + v

    final_prompt = f"{context_block}\n\n---\n\n{prompt}" if context_block else prompt

    conn.execute(
        """INSERT INTO injection_log (user_id, workspace_id, platform, redaction_count, day, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user["id"], body.workspace_id, body.platform, sum(redactions.values()), today(), now_iso()),
    )
    conn.commit()
    return {"final_prompt": final_prompt, "rules_used": len(rules), "redactions": redactions}


@app.post("/security/scrub")
def scrub_endpoint(body: ScrubIn, user: dict = Depends(get_current_user)):
    """Standalone scrubber (handy for the dashboard's 'test the filter' demo)."""
    clean, found = scrub_text(body.text)
    return {"clean_text": clean, "redactions": found, "total": sum(found.values())}


# =====================================================================
# Team workspaces (per-seat)
# =====================================================================
@app.post("/workspaces", status_code=201)
def create_workspace(body: WorkspaceIn, user: dict = Depends(get_current_user),
                     conn: sqlite3.Connection = Depends(get_db)):
    now = now_iso()
    cur = conn.execute(
        "INSERT INTO workspaces (name, owner_id, seat_limit, created_at) VALUES (?, ?, ?, ?)",
        (body.name, user["id"], body.seat_limit, now),
    )
    conn.execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        (cur.lastrowid, user["id"], now),
    )
    conn.commit()
    return {"id": cur.lastrowid, "name": body.name, "seat_limit": body.seat_limit, "seats_used": 1, "role": "owner"}


@app.get("/workspaces")
def list_workspaces(user: dict = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        """SELECT w.id, w.name, w.seat_limit, m.role,
                  (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) AS seats_used
           FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
           WHERE m.user_id = ? ORDER BY w.id""",
        (user["id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/workspaces/{workspace_id}/members")
def list_members(workspace_id: int, user: dict = Depends(get_current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    require_role(conn, workspace_id, user["id"])
    rows = conn.execute(
        """SELECT u.id, u.name, u.email, m.role, m.joined_at
           FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ? ORDER BY m.joined_at""",
        (workspace_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/workspaces/{workspace_id}/members", status_code=201)
def add_member(workspace_id: int, body: MemberIn, user: dict = Depends(get_current_user),
               conn: sqlite3.Connection = Depends(get_db)):
    require_role(conn, workspace_id, user["id"], ("owner", "admin"))
    ws = conn.execute("SELECT seat_limit FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
    used = conn.execute(
        "SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?", (workspace_id,)
    ).fetchone()["n"]
    if used >= ws["seat_limit"]:
        raise HTTPException(402, "No free seats left. Buy more seats to add members.")
    target = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
    if target is None:
        raise HTTPException(404, "No user with that email. They must register first.")
    if get_role(conn, workspace_id, target["id"]):
        raise HTTPException(409, "Already a member")
    conn.execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
        (workspace_id, target["id"], body.role, now_iso()),
    )
    conn.commit()
    return {"added": body.email, "seats_used": used + 1, "seat_limit": ws["seat_limit"]}


@app.delete("/workspaces/{workspace_id}/members/{member_id}", status_code=204)
def remove_member(workspace_id: int, member_id: int, user: dict = Depends(get_current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    require_role(conn, workspace_id, user["id"], ("owner", "admin"))
    if get_role(conn, workspace_id, member_id) == "owner":
        raise HTTPException(400, "Cannot remove the workspace owner")
    conn.execute("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?", (workspace_id, member_id))
    conn.commit()


@app.post("/workspaces/{workspace_id}/seats")
def set_seats(workspace_id: int, body: SeatsIn, user: dict = Depends(get_current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    """MOCK billing: owner changes the paid seat count. Wire Stripe here later."""
    require_role(conn, workspace_id, user["id"], ("owner",))
    used = conn.execute(
        "SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?", (workspace_id,)
    ).fetchone()["n"]
    if body.seat_limit < used:
        raise HTTPException(400, f"{used} seats are in use; remove members first.")
    conn.execute("UPDATE workspaces SET seat_limit = ? WHERE id = ?", (body.seat_limit, workspace_id))
    conn.commit()
    return {"seat_limit": body.seat_limit, "seats_used": used}


@app.get("/workspaces/{workspace_id}/audit")
def workspace_audit(workspace_id: int, user: dict = Depends(get_current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Governance numbers for the admin dashboard: 'X secrets blocked this month'."""
    require_role(conn, workspace_id, user["id"], ("owner", "admin"))
    row = conn.execute(
        """SELECT COUNT(*) AS total_injections, COALESCE(SUM(redaction_count), 0) AS total_redactions
           FROM injection_log WHERE workspace_id = ?""",
        (workspace_id,),
    ).fetchone()
    return dict(row)

from pathlib import Path
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/")

app.mount("/app", StaticFiles(directory=Path(__file__).parent / "web", html=True), name="web")