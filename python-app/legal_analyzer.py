"""Legal document analysis logic - no UI imports.

Extracts structure (parties, dates, money, governing law), segments clauses,
classifies each clause into a legal category with TF-IDF + nearest-centroid
similarity over an embedded labeled corpus, and scores risk per clause with a
curated lexicon. Fully offline: no model downloads, no APIs.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field, asdict

CLAUSE_TYPES = [
    "termination", "liability", "indemnification", "confidentiality",
    "payment", "intellectual_property", "warranty", "governing_law",
    "non_compete", "force_majeure", "assignment", "dispute_resolution",
]

# Small embedded corpus: (clause-type, example phrases). Each type gets
# several paraphrases so TF-IDF nearest-centroid has something real to learn.
_CORPUS = {
    "termination": [
        "either party may terminate this agreement upon thirty days written notice",
        "this agreement may be terminated immediately for material breach",
        "termination for convenience with prior notice to the other party",
        "upon termination all rights granted hereunder shall cease",
        "the term of this agreement and renewal and expiration of the term",
    ],
    "liability": [
        "in no event shall either party be liable for indirect consequential damages",
        "the aggregate liability shall not exceed the amounts paid",
        "limitation of liability cap on damages arising out of this agreement",
        "excluding liability for death or personal injury caused by negligence",
        "no liability for loss of profits revenue data or business opportunity",
    ],
    "indemnification": [
        "shall indemnify defend and hold harmless the other party from claims",
        "indemnification against third party claims arising from breach",
        "the indemnifying party shall pay all losses damages and expenses",
        "hold harmless from any claim demand suit or proceeding",
    ],
    "confidentiality": [
        "each party agrees to keep confidential information strictly confidential",
        "non disclosure of proprietary information during and after the term",
        "confidential information shall not be disclosed to third parties",
        "obligations of confidentiality survive termination of this agreement",
    ],
    "payment": [
        "payment shall be due within thirty days of invoice date",
        "late payments accrue interest at the rate per month",
        "fees expenses and payment terms net thirty days",
        "all amounts are exclusive of taxes which shall be payable by customer",
    ],
    "intellectual_property": [
        "all intellectual property rights in the work product shall vest in",
        "ownership of inventions patents copyrights and trademarks",
        "license to use the software and underlying intellectual property",
        "moral rights are waived to the fullest extent permitted by law",
    ],
    "warranty": [
        "represents and warrants that the services will be performed professionally",
        "disclaims all implied warranties of merchantability and fitness",
        "the warranty period shall be twelve months from delivery",
        "provided as is without warranty of any kind express or implied",
    ],
    "governing_law": [
        "this agreement shall be governed by the laws of the state of",
        "governing law and jurisdiction of the courts of",
        "construed in accordance with the laws of england and wales",
        "subject to the exclusive jurisdiction of the courts",
    ],
    "non_compete": [
        "shall not compete with the business for a period of two years",
        "non solicitation of employees customers or suppliers",
        "restrictive covenant not to engage in competing business within",
        "during the restricted period the party shall not solicit",
    ],
    "force_majeure": [
        "neither party shall be liable for failure due to force majeure",
        "acts of god war pandemic government action or other events beyond control",
        "force majeure event suspends performance obligations",
    ],
    "assignment": [
        "may not assign this agreement without prior written consent",
        "assignment or transfer of rights and obligations hereunder",
        "this agreement binds and benefits successors and permitted assigns",
    ],
    "dispute_resolution": [
        "disputes shall be resolved by binding arbitration",
        "mediation followed by arbitration under the rules of",
        "the parties agree to resolve disputes through good faith negotiation",
        "waive the right to a jury trial and class action",
    ],
}

RISK_LEXICON = {
    "high": [
        "unlimited liability", "sole discretion", "without notice", "irrevocable",
        "perpetual", "in perpetuity", "irrevocably", "waive", "waiver of all", "hold harmless", "unilateral",
        "at its sole option", "without cause", "no liability whatsoever",
        "assigns all rights", "exclusive ownership", "non-refundable",
    ],
    "medium": [
        "may terminate", "indemnify", "liquidated damages", "penalty",
        "binding arbitration", "waive the right", "auto-renew", "automatic renewal",
        "shall not compete", "exclusive jurisdiction", "time is of the essence",
        "entire agreement", "severability",
    ],
}

RE_MONEY = re.compile(r"(?:[$€£₹]\s?[\d,]+(?:\.\d{1,2})?|\b\d+(?:,\d{3})*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|dollars|rupees))", re.I)
RE_DATE = re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b")
RE_GOVERNING = re.compile(r"governed by (?:and construed in accordance with )?the laws? of ([^.;,\n]{2,60})", re.I)
RE_JURISDICTION = re.compile(r"(?:exclusive )?jurisdiction of (?:the )?(?:courts? (?:of|in) )?([^.;,\n]{2,60})", re.I)
RE_DAYS_NOTICE = re.compile(r"(\d{1,3})\s*(?:\(\d+\)\s*)?days?['\u2019]?\s*(?:prior )?(?:written )?notice", re.I)


def _segment(text: str) -> list[str]:
    """Split into clause-like chunks on headings and sentence boundaries."""
    text = re.sub(r"\r\n?", "\n", text)
    chunks = []
    for block in re.split(r"\n\s*\n|(?=\n\s*\d+\.\s+[A-Z])", text):
        block = block.strip()
        if not block:
            continue
        # split long blocks into sentence groups of ~2 sentences
        sents = re.split(r"(?<=[.!?])\s+(?=[A-Z])", block)
        buf, n = [], 0
        for s in sents:
            buf.append(s)
            n += 1
            if n >= 2 or sum(len(x) for x in buf) > 400:
                chunks.append(" ".join(buf).strip())
                buf, n = [], 0
        if buf:
            chunks.append(" ".join(buf).strip())
    return [c for c in chunks if len(c.split()) >= 4]


def _build_index():
    from sklearn.feature_extraction.text import TfidfVectorizer
    docs, labels = [], []
    for label, phrases in _CORPUS.items():
        for p in phrases:
            docs.append(p)
            labels.append(label)
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    X = vec.fit_transform(docs)
    return vec, X, labels


def _classify(vec, X, labels, clause: str) -> tuple[str, float]:
    import numpy as np
    v = vec.transform([clause.lower()])
    sims = (v @ X.T).toarray()[0]
    if sims.max() <= 0:
        return "other", 0.0
    # best matching corpus phrase wins
    i = int(np.argmax(sims))
    return labels[i], float(sims[i])


def _risk(clause: str) -> tuple[str, list[str]]:
    low = clause.lower()
    hits_h = [p for p in RISK_LEXICON["high"] if p in low]
    hits_m = [p for p in RISK_LEXICON["medium"] if p in low]
    if hits_h:
        return "high", hits_h + hits_m
    if hits_m:
        return "medium", hits_m
    return "low", []


def _defined_terms(text: str) -> list[str]:
    terms = re.findall(r"[\"“]([A-Z][^\"”]{1,50})[\"”]\s*(?:shall mean|means|refers to)", text)
    terms += re.findall(r"\(the [\"“]([A-Z][^\"”]{1,50})[\"”]\)", text)
    seen, out = set(), []
    for t in terms:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out[:30]


def _parties(text: str) -> list[str]:
    m = re.findall(r"between\s+([A-Z][^,.\n]{2,70}?)(?:,|\s+(?:and|&)\s+|\s+hereinafter)", text[:4000])
    parties = [p.strip() for p in m if len(p.strip()) > 2]
    # second party after "and"
    m2 = re.findall(r"\band\s+([A-Z][^,.\n]{2,70}?)(?:,|\s+hereinafter|\s*\()", text[:4000])
    for p in m2:
        p = p.strip()
        if len(p) > 2 and p not in parties and not p.lower().startswith(("the ", "this ")):
            parties.append(p)
    return parties[:4]


def analyze(text: str) -> dict:
    """Analyze a legal document. Returns a JSON-able dict."""
    if not text or len(text.strip()) < 40:
        raise ValueError("Document text is too short to analyze (need at least ~40 characters).")
    vec, X, labels = _build_index()
    clauses = []
    for c in _segment(text):
        ctype, conf = _classify(vec, X, labels, c)
        risk, hits = _risk(c)
        clauses.append({
            "text": c[:600],
            "type": ctype,
            "confidence": round(conf, 3),
            "risk": risk,
            "risk_phrases": hits,
        })
    type_counts = {}
    for c in clauses:
        if c["type"] != "other":
            type_counts[c["type"]] = type_counts.get(c["type"], 0) + 1
    g = RE_GOVERNING.search(text)
    j = RE_JURISDICTION.search(text)
    notices = sorted({int(m.group(1)) for m in RE_DAYS_NOTICE.finditer(text)})
    risk_order = {"high": 0, "medium": 1, "low": 2}
    top_risky = sorted([c for c in clauses if c["risk"] != "low"],
                       key=lambda c: risk_order[c["risk"]])[:10]
    return {
        "summary": {
            "clause_count": len(clauses),
            "high_risk": sum(1 for c in clauses if c["risk"] == "high"),
            "medium_risk": sum(1 for c in clauses if c["risk"] == "medium"),
            "type_counts": type_counts,
        },
        "parties": _parties(text),
        "defined_terms": _defined_terms(text),
        "governing_law": g.group(1).strip() if g else None,
        "jurisdiction": j.group(1).strip() if j else None,
        "notice_periods_days": notices,
        "money_mentions": sorted(set(RE_MONEY.findall(text)))[:20],
        "dates_mentioned": sorted(set(RE_DATE.findall(text)))[:20],
        "top_risky_clauses": [{"type": c["type"], "risk": c["risk"],
                               "risk_phrases": c["risk_phrases"], "text": c["text"]} for c in top_risky],
        "clauses": clauses,
    }
