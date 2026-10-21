import streamlit as st
from legal_analyzer import analyze

st.set_page_config(page_title="Legal Doc Analyzer (Python)", page_icon="⚖", layout="wide")
st.title("Legal Document Analyzer")
st.caption("Clause classification, entity extraction and risk flagging - fully offline, TF-IDF + curated legal lexicon.")

SAMPLE = """CONSULTING AGREEMENT

This Consulting Agreement (the "Agreement") is entered into between Meridian Labs, Inc. and Joanna Reed, effective March 1, 2026.

1. SERVICES. The Consultant will provide product strategy services as described in each statement of work.

2. PAYMENT. Fees of $12,000 per month, invoiced monthly. Payment shall be due within 30 days of invoice date. Late payments accrue interest at 1.5% per month.

3. CONFIDENTIALITY. Each party agrees to keep Confidential Information strictly confidential and shall not disclose it to third parties.

4. TERMINATION. Either party may terminate this Agreement upon 14 days written notice. The Company may also terminate immediately for material breach.

5. INDEMNIFICATION. The Consultant shall indemnify, defend and hold harmless the Company from third-party claims arising from the Consultant's breach.

6. LIABILITY. In no event shall either party be liable for indirect or consequential damages. Aggregate liability shall not exceed the amounts paid in the prior 6 months.

7. GOVERNING LAW. This Agreement shall be governed by the laws of the State of New York, with exclusive jurisdiction of the courts of New York County."""

text = st.text_area("Paste contract text", value=SAMPLE, height=260)
if st.button("Analyze", type="primary"):
    try:
        r = analyze(text)
    except ValueError as e:
        st.error(str(e)); st.stop()
    s = r["summary"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Clauses", s["clause_count"]); c2.metric("High risk", s["high_risk"])
    c3.metric("Medium risk", s["medium_risk"]); c4.metric("Defined terms", len(r["defined_terms"]))
    st.subheader("Document facts")
    cols = st.columns(2)
    with cols[0]:
        st.write("**Parties:**", ", ".join(r["parties"]) or "not detected")
        st.write("**Governing law:**", r["governing_law"] or "not detected")
        st.write("**Jurisdiction:**", r["jurisdiction"] or "not detected")
        st.write("**Notice periods (days):**", r["notice_periods_days"] or "none")
    with cols[1]:
        st.write("**Money mentions:**", ", ".join(r["money_mentions"][:8]) or "none")
        st.write("**Dates:**", ", ".join(r["dates_mentioned"][:6]) or "none")
        st.write("**Defined terms:**", ", ".join(r["defined_terms"][:10]) or "none")
    if r["top_risky_clauses"]:
        st.subheader("Risky clauses")
        for c in r["top_risky_clauses"]:
            with st.expander(f"[{c['risk'].upper()}] {c['type'].replace('_',' ')} - {', '.join(c['risk_phrases'])}"):
                st.write(c["text"])
    st.subheader("Clause map")
    st.bar_chart(s["type_counts"])
    with st.expander("All classified clauses"):
        for c in r["clauses"]:
            st.write(f"**{c['type']}** ({c['confidence']:.2f}, risk {c['risk']}): {c['text'][:200]}")
