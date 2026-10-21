# Legal Doc Analyzer - Python (scikit-learn)

The pro-grade version of the browser demo: offline clause classification with TF-IDF nearest-neighbor over an embedded legal clause corpus, entity extraction (parties, governing law, jurisdiction, notice periods, money, dates, defined terms) and a curated risk lexicon.

## Stack

- **scikit-learn TfidfVectorizer** - 1-2 gram TF-IDF; each clause matched to its nearest embedded exemplar across 12 clause types
- **Regex entity layer** - governing law, jurisdiction, notice periods, money (multi-currency), dates, defined terms, parties
- **Risk lexicon** - high/medium phrase sets (sole discretion, without notice, in perpetuity, indemnify, binding arbitration...)
- **Streamlit** - paste text, metrics, document facts, risky-clause list, clause-type chart

## Run locally

```
pip install -r requirements.txt
streamlit run app.py
```

## Tests

```
python3 tests/test_legal_analyzer.py     # or: python3 -m pytest tests/ -q
```

Covers clause-type recall on a sample NDA, entity extraction, high-risk phrase detection on a hostile employment contract, clean-doc low risk, and short-input rejection.

## Honest limits

- Nearest-exemplar classification is a baseline, not a lawyer: unusual clause wording can misclassify.
- The risk lexicon flags known-hostile phrases; absence of a flag is not legal advice.
- Extraction regexes handle common drafting styles; exotic formatting may be missed.

## Layout

- `legal_analyzer.py` - pure logic (no Streamlit imports), fully unit tested
- `app.py` - Streamlit UI
- `tests/test_legal_analyzer.py` - unit tests
