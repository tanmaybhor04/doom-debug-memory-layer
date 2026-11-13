# API Contract (give this to the Extension + Dashboard teammates)

Base URL (local): `http://localhost:8000`  |  Live interactive docs: `/docs`

All endpoints except `/health`, `/auth/register`, `/auth/login` need the header:
`Authorization: Bearer <token>`

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | /auth/register | `{email, name, password(min 8)}` | `{token, user}` |
| POST | /auth/login | `{email, password}` | `{token, user}` |
| GET | /me | - | `{id, email, name, plan}` |
| POST | /me/upgrade | - | user with plan `pro` (mock billing) |
| GET | /rules | - | all rules visible to user (personal + team) |
| POST | /rules | `{title, content, category?, priority?, is_active?, workspace_id?}` | created rule |
| PATCH | /rules/{id} | any subset of the fields above | updated rule |
| DELETE | /rules/{id} | - | 204 |
| GET | /context?workspace_id= | - | `{rules_count, context_block, rules[]}` |
| **POST** | **/inject** | `{prompt, platform, workspace_id?, scrub?}` | `{final_prompt, rules_used, redactions}` |
| POST | /security/scrub | `{text}` | `{clean_text, redactions, total}` |
| POST | /workspaces | `{name, seat_limit?}` | workspace |
| GET | /workspaces | - | workspaces + `role`, `seats_used` |
| GET | /workspaces/{id}/members | - | members |
| POST | /workspaces/{id}/members | `{email, role?}` | `{added, seats_used, seat_limit}` |
| DELETE | /workspaces/{id}/members/{user_id} | - | 204 |
| POST | /workspaces/{id}/seats | `{seat_limit}` | mock seat purchase |
| GET | /workspaces/{id}/audit | - | `{total_injections, total_redactions}` |

## Extension flow (the only call it really needs)
1. User logs in once -> store `token` in `chrome.storage.local`
2. User hits Send on ChatGPT -> extension calls `POST /inject` with `{prompt: <typed text>, platform: "chatgpt"}`
3. Replace the textbox content with `final_prompt`, then submit.

## Status codes to handle in the UI
- 401 -> token missing/expired, ask user to log in
- 402 -> free-plan limit hit (rules or daily injections) or no free seats: show an Upgrade prompt
- 403 -> not allowed (e.g. a normal member trying to edit team rules)
