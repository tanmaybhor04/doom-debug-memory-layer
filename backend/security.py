"""
Enterprise Security Governance: scrub secrets and PII from text BEFORE it goes to an LLM.

Layers (applied in this order):
  1. Regex for known secret formats (API keys, tokens, private keys, connection strings)
  2. Regex for "password = something" style assignments (only the value is removed)
  3. Regex + validators for PII (credit cards w/ Luhn check, emails, phones, Aadhaar, PAN, SSN)
  4. Light NLP heuristics: names after phrases like "client name is ..." / "Dr. ..."
  5. Shannon-entropy check: catches random-looking strings that match no known format

Standard library only.
"""
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class Rule:
    name: str
    category: str                       # "secret" or "pii"
    pattern: re.Pattern
    group: int = 0                      # which regex group to replace (0 = whole match)
    validator: Optional[Callable[[str], bool]] = None


# ---------- validators ----------
def _luhn_ok(value: str) -> bool:
    digits = [int(c) for c in re.sub(r"\D", "", value)]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _entropy(s: str) -> float:
    counts = Counter(s)
    return -sum((c / len(s)) * math.log2(c / len(s)) for c in counts.values())


def _looks_random(value: str) -> bool:
    return (
        any(c.isdigit() for c in value)
        and any(c.isalpha() for c in value)
        and not value.startswith("[REDACTED")
        and _entropy(value) >= 4.0
    )


def _r(pattern: str, flags: int = 0) -> re.Pattern:
    return re.compile(pattern, flags)


# ---------- the rules (ORDER MATTERS: specific first, generic last) ----------
RULES: list[Rule] = [
    # --- secrets ---
    Rule("PRIVATE_KEY", "secret", _r(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----")),
    Rule("CONNECTION_STRING", "secret", _r(r"\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:[^\s@/]+@[^\s]+", re.I)),
    Rule("ANTHROPIC_KEY", "secret", _r(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")),
    Rule("OPENAI_KEY", "secret", _r(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}")),
    Rule("AWS_ACCESS_KEY", "secret", _r(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    Rule("GITHUB_TOKEN", "secret", _r(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{22,}")),
    Rule("GOOGLE_API_KEY", "secret", _r(r"\bAIza[0-9A-Za-z_\-]{35}")),
    Rule("SLACK_TOKEN", "secret", _r(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}")),
    Rule("STRIPE_KEY", "secret", _r(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}")),
    Rule("JWT", "secret", _r(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")),
    Rule("BEARER_TOKEN", "secret", _r(r"\bbearer\s+([A-Za-z0-9._~+/=\-]{20,})", re.I), group=1),
    Rule(
        "PASSWORD",
        "secret",
        _r(
            r"(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)"
            r"[A-Za-z_]*(?:\s*[:=]\s*|\s+is\s+)[\"']?(?!\[REDACTED)([^\s\"',;]+)[\"']?",
            re.I,
        ),
        group=1,
    ),
    # --- PII ---
    Rule("CREDIT_CARD", "pii", _r(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), validator=_luhn_ok),
    Rule("SSN", "pii", _r(r"\b\d{3}-\d{2}-\d{4}\b")),
    Rule("AADHAAR", "pii", _r(r"\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b")),
    Rule("PAN", "pii", _r(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    Rule("EMAIL", "pii", _r(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    Rule("PHONE", "pii", _r(r"(?<![\w.])\+\d{1,3}[\s\-]?\d{4,5}[\s\-]?\d{4,6}(?!\w)")),
    Rule(
        "PHONE",
        "pii",
        _r(r"(?<![\w.\-])(?:\d{3}[\s.\-]\d{3}[\s.\-]\d{4}|\(\d{3}\)\s?\d{3}[\s.\-]\d{4}|[6-9]\d{9})(?![\w\-])"),
    ),
    Rule(
        "INTERNAL_IP",
        "pii",
        _r(r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b"),
    ),
    # --- light NLP: names introduced by trigger phrases (case-sensitive name part) ---
    Rule(
        "PERSON_NAME",
        "pii",
        _r(
            r"\b(?i:my name is|client name is|client is|customer name is|customer is|contact is|meeting with)\s+"
            r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})"
        ),
        group=1,
    ),
    Rule("PERSON_NAME", "pii", _r(r"\b(?:Mr|Mrs|Ms|Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)"), group=1),
    # --- last resort: random-looking long strings ---
    Rule(
        "HIGH_ENTROPY_SECRET",
        "secret",
        _r(r"(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9_\-+/=]{24,}(?![A-Za-z0-9_\-+/=])"),
        validator=_looks_random,
    ),
]


def scrub_text(text: str) -> tuple[str, dict[str, int]]:
    """Return (clean_text, {finding_type: count})."""
    counts: Counter = Counter()

    for rule in RULES:

        def replace(m: re.Match, rule: Rule = rule) -> str:
            value = m.group(rule.group)
            if rule.validator and not rule.validator(value):
                return m.group(0)
            counts[rule.name] += 1
            placeholder = f"[REDACTED_{rule.name}]"
            if rule.group == 0:
                return placeholder
            start = m.start(rule.group) - m.start()
            end = m.end(rule.group) - m.start()
            whole = m.group(0)
            return whole[:start] + placeholder + whole[end:]

        text = rule.pattern.sub(replace, text)

    return text, dict(counts)
