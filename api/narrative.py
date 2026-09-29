from __future__ import annotations

import functools
import os
from dotenv import load_dotenv   # <--- ADDED LINE

load_dotenv()# <--- ADDED LINE

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
SYSTEM_INSTRUCTION = (
    "You are a forensic audit officer of the Comptroller and Auditor General of India writing for a "
    "Ministry-level executive. Respond with exactly two sentences of formal audit prose, no markdown, "
    "no bullets, no hedging. Sentence one: name the work, the sanctioned value and the specific control "
    "failures detected. Sentence two: state the audit consequence and the recommended action. Use only "
    "the facts supplied; never invent figures."
)
_client = None

def _get_client():
    global _client
    if _client is None:
        from google import genai
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is missing!")
        _client = genai.Client(api_key=api_key)
    return _client

def _facts(rec: dict) -> str:
    return (
        f"Work {rec['work_id']} ({rec.get('work_category')}) sanctioned to MP {rec.get('mp_name')}, "
        f"{rec.get('district')}, {rec.get('state')}. Sanctioned ₹{rec['sanctioned_amount']:.2f} lakh, "
        f"released ₹{rec['released_amount']:.2f} lakh, status {rec.get('status')}. Composite risk "
        f"{rec['risk_score']:.0f}/100 ({rec['risk_tier']}). Findings: {'; '.join(rec.get('reasons', []))}."
    )

def _fallback(rec: dict) -> str:
    chips = ", ".join(rec.get("reason_chips", [])) or "statistical anomaly"
    return (
        f"Work {rec['work_id']} sanctioned at ₹{rec['sanctioned_amount']:.2f} lakh under {rec.get('mp_name')} "
        f"exhibits the following control failures: {chips}. The record is assigned {rec['risk_tier']} risk "
        f"({rec['risk_score']:.0f}/100) and is recommended for physical verification and release hold pending inspection."
    )

@functools.lru_cache(maxsize=1024)
def _generate(facts: str) -> str:
    from google.genai import types
    client = _get_client()
    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=facts,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION, 
            temperature=0.2, 
            max_output_tokens=160
        ),
    )
    return (resp.text or "").strip()

def executive_brief(rec: dict) -> str:
    """Feature 4. Accepts one register record and returns a two-sentence briefing."""
    if not os.environ.get("GEMINI_API_KEY"):
        return _fallback(rec)
    try:
        result = _generate(_facts(rec))
        return result if result else _fallback(rec)
    except Exception as e:
        print(f"[GEMINI NARRATIVE ERROR]: {e}")  # Prints the real error to your terminal instead of hiding it
        return _fallback(rec)