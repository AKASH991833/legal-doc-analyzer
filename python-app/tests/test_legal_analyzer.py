import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from legal_analyzer import analyze, _segment, _defined_terms, _parties

NDA = '''
MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into between Acme Corporation, a Delaware corporation, and Beta Industries Ltd, a private limited company, effective January 15, 2026.

1. CONFIDENTIALITY. Each party agrees to keep Confidential Information strictly confidential and shall not disclose it to any third party. Obligations of confidentiality survive termination of this Agreement for five years.

2. TERM AND TERMINATION. Either party may terminate this Agreement upon 30 days written notice to the other party. Upon termination all rights granted hereunder shall cease.

3. NO LICENSE. Nothing in this Agreement grants any license to intellectual property.

4. GOVERNING LAW. This Agreement shall be governed by the laws of the State of Delaware, and the parties submit to the exclusive jurisdiction of the courts of Wilmington, Delaware.

5. LIABILITY. In no event shall either party be liable for indirect or consequential damages. The aggregate liability shall not exceed $50,000 USD.

6. DISPUTES. Any disputes shall be resolved by binding arbitration, and each party waives the right to a jury trial.
'''

EMP = '''
EMPLOYMENT AGREEMENT

This Employment Agreement is between Northwind Traders and Priya Sharma, dated 2026-02-01.

1. NON-COMPETE. The Employee shall not compete with the business for a period of two years within 50 miles, and shall not solicit employees or customers during the restricted period.

2. COMPENSATION. Salary of ₹18,00,000 per annum, payable monthly. Payment shall be due within 5 days of month end.

3. IP ASSIGNMENT. All intellectual property rights in work product shall vest in the Company, and the Employee assigns all rights irrevocably and in perpetuity. Moral rights are waived to the fullest extent permitted by law.

4. TERMINATION. The Company may terminate this Agreement at its sole discretion, without cause and without notice. Severance is non-refundable.

5. FORCE MAJEURE. Neither party shall be liable for failure to perform due to force majeure events including acts of god, war, or pandemic.
'''

def test_segments_nda():
    r = analyze(NDA)
    types = r["summary"]["type_counts"]
    assert types.get("confidentiality", 0) >= 1, types
    assert types.get("termination", 0) >= 1, types
    assert types.get("governing_law", 0) >= 1, types
    assert types.get("liability", 0) >= 1, types
    assert types.get("dispute_resolution", 0) >= 1, types

def test_entities_nda():
    r = analyze(NDA)
    assert r["governing_law"] and "Delaware" in r["governing_law"]
    assert r["jurisdiction"] and "Wilmington" in r["jurisdiction"]
    assert 30 in r["notice_periods_days"]
    assert any("50,000" in m for m in r["money_mentions"])
    assert any("January 15, 2026" in d for d in r["dates_mentioned"])
    assert any("Acme" in p for p in r["parties"]), r["parties"]
    assert "Agreement" in r["defined_terms"]

def test_risk_employment():
    r = analyze(EMP)
    assert r["summary"]["high_risk"] >= 2, r["summary"]
    phrases = " ".join(p for c in r["top_risky_clauses"] for p in c["risk_phrases"])
    assert "sole discretion" in phrases or "without notice" in phrases
    assert "irrevocably" in phrases or "in perpetuity" in phrases
    assert r["summary"]["type_counts"].get("non_compete", 0) >= 1
    assert r["summary"]["type_counts"].get("force_majeure", 0) >= 1
    assert r["summary"]["type_counts"].get("intellectual_property", 0) >= 1

def test_short_input_rejected():
    try:
        analyze("too short")
        assert False, "expected ValueError"
    except ValueError:
        pass

def test_clean_doc_low_risk():
    r = analyze("SERVICE SCHEDULE. The provider will deliver reports quarterly. "
                "Reports include usage summaries and recommendations. "
                "Either party may request changes in writing. "
                "Fees are invoiced quarterly and payment shall be due within 30 days of invoice date.")
    assert r["summary"]["high_risk"] == 0

def test_segments_require_words():
    assert _segment("Hi. Bye.") == []

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"All {len(fns)} tests passed.")
