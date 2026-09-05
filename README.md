# ReconAI — AI Finance Controller

> **Razorpay AI Buildathon — Track 04 (AI Finance Controller)**  
> A confidence-scored, GST/TDS-aware, 5-pass reconciliation engine for Indian SMEs.

---

## What it does

Given a batch of bank transactions and invoices for an Indian SME merchant, ReconAI:

1. **Matches** each bank transaction to the invoice(s) it settles across 5 passes: exact rules → fuzzy matching → semantic embeddings → subset-sum split detection → LLM adjudication.
2. **Applies Indian finance rules** correctly: GST (CGST+SGST / IGST), TDS deductions (194J/194C/194Q), payment gateway fee netting, and ±₹1–2 rounding conventions.
3. **Scores every match** 0–100 with a human-readable explanation and a deterministic confidence band (auto_accept / review / reject).
4. **Reports exceptions honestly** — every unresolved record gets a stated, machine-readable reason. The LLM is an enhancement; it never suppresses an exception.
5. **Produces precision/recall** against labeled ground truth, broken down by 15 case categories (GST rounding, TDS, split payments, near-duplicates, etc.).
6. **Maintains a full audit trail** — every pass's score contribution, the LLM's raw JSON response, and the threshold snapshot in effect at run time.

---

## Measured Accuracy

Live evaluation against 71-record synthetic batch with labeled ground truth:

| Metric | Target | Result |
|---|---|---|
| Auto-Accept Precision | ≥ 95% | **97.96%** (48 TP, 1 FP) |
| Auto-Accept Recall | ≥ 90% | **97.96%** (48 TP, 1 FN) |
| F1 Score | — | **97.96%** |
| Exception Completeness | 100% | **100.0%** (8/8) |
| False-Positive Cost | Disclosed | **₹68,000** (1 FP, Cat 15 bank duplicate) |
| Throughput | < 2s/record | **0.73s/record** |

**Per-category precision:**
- Cat 1 (Exact 1:1 Match): 100% · Cat 2 (GST Rounding): 100% · Cat 3 (TDS-Adjusted): 100%
- Cat 4 (Split Settlements): 100% · Cat 8 (Near-Duplicate): 100% · Cat 9 (Missing Ref): 100%
- Cat 15 (Bank Duplicate, n=1): 0% — disclosed honestly as a known limitation

---

## Architecture

```
┌─────────────────────────────── Next.js Frontend (App Router) ──────────────────────────────┐
│  Upload  │  Live SSE Run View  │  Results Dashboard  │  Exception Queue  │  Audit Trail     │
└──────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                       │ REST + Server-Sent Events
┌──────────────────────────────────────▼─────────────────────────────────────────────────────┐
│                              FastAPI Backend (Python)                                        │
│                                                                                              │
│  ┌─────────────┐   ┌──────────────────────────────────────────────────────────────────────┐│
│  │ API Layer   │──▶│          Reconciliation Orchestrator                                  ││
│  │ (6 routers) │   └────────────────────────────┬─────────────────────────────────────────┘│
│  └─────────────┘                                │                                           │
│                          ┌──────────┬───────────┼────────────┬────────────┐                │
│                          ▼          ▼           ▼            ▼            ▼                │
│                    ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐          │
│                    │ Pass 1   │ │ Pass 2 │ │ Pass 3 │ │ Pass 4   │ │ Pass 5   │          │
│                    │ Rules/   │ │ Fuzzy  │ │ Embed. │ │ Subset-  │ │ LLM Adj. │          │
│                    │ Exact    │ │ (rapid)│ │ (MiniL)│ │ Sum +    │ │ Gemini → │          │
│                    │          │ │        │ │        │ │ Hungarian│ │ Groq     │          │
│                    └──────────┘ └────────┘ └────────┘ └──────────┘ └──────────┘          │
│                                                    ▼                                        │
│                    ┌─────────────────────────────────────────────────────────────────────┐ │
│                    │  Confidence Scorer → Decision Router → Audit Logger                 │ │
│                    └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                           │
                              MongoDB Atlas M0 (Beanie ODM)
```

### 5-Pass Pipeline

| Pass | Algorithm | Fires on |
|---|---|---|
| **Pass 1** — Rules Engine | Exact ref match → amount match → TDS formula → fee formula | All records |
| **Pass 2** — Fuzzy | `rapidfuzz` token_sort_ratio + Gaussian amount/date decay | Unresolved after P1 |
| **Pass 3** — Embeddings | `all-MiniLM-L6-v2` cosine similarity, local, no API cost | Unresolved after P2 |
| **Pass 4** — Split/Combo | Subset-sum (integer paise DP) + Hungarian optimal assignment | Unresolved after P3 |
| **Pass 5** — LLM | Gemini 3.6-flash → Groq compound-mini → Groq qwen3.6-27b | Review-band + flagged |

### LLM Resilience Chain

```
Gemini 3.6-flash (primary)
  ─── 429/503 → immediate skip (RateLimitError, no retry)
Groq compound-mini (fallback)
  ─── 429 TPD → automatic secondary
Groq qwen3.6-27b (secondary, separate daily quota)
  ─── exhausted → fallback_no_llm()
         → batch still completes, record flagged pending_llm_enrichment
```

The LLM **never** makes the final accept/reject decision — it provides a bounded confidence delta (±20) and a plain-English explanation. The deterministic confidence scorer applies the actual thresholds. A hallucinating LLM call cannot silently corrupt the ledger.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.3.3 (App Router, Turbopack), TypeScript |
| Backend | FastAPI (Python 3.11+), Uvicorn, async |
| Database | MongoDB Atlas M0, Beanie ODM (async Pydantic v2) |
| Fuzzy matching | `rapidfuzz` (token_sort_ratio + Gaussian decay) |
| Semantic matching | `sentence-transformers/all-MiniLM-L6-v2` (local, CPU) |
| LLM Primary | Gemini 3.6-flash (thinking model) |
| LLM Fallback | Groq compound-mini → Groq qwen/qwen3.6-27b |
| Optimal assignment | Hungarian algorithm (scipy) |
| Anomaly detection | Benford's Law analysis |

---

## Local Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- A free [MongoDB Atlas](https://cloud.mongodb.com) M0 cluster

### 1. Clone and configure

```bash
git clone <repo-url>
cd Milaan
cp .env.example .env
# Fill in: MONGODB_URI, GEMINI_API_KEY, GROQ_API_KEY
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Verify Atlas connected:
```bash
curl http://localhost:8000/health
# {"status":"ok","atlas":"connected","db":"reconai","thresholds":{"auto_accept":85.0,"review":50.0}}
```

### 3. Load synthetic data

```bash
# From repo root — generates 71 records + ground truth labels into MongoDB
cd backend
python data/generate_synthetic_data.py
```

Or upload the pre-generated CSV files in `test_data/evaluation_batch/` via the UI.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# http://localhost:3000
```

### 5. Docker (optional)

```bash
docker-compose up --build
```

### 6. Run evaluation (CLI)

```bash
# From repo root — runs full batch against ground truth, prints precision/recall table
python backend/run_evaluation_batch.py
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/batches` | Upload bank CSV + invoice CSV |
| `POST` | `/api/batches/{id}/run` | Trigger reconciliation run |
| `GET` | `/api/batches/{id}/run/{run_id}/stream` | SSE live progress feed |
| `GET` | `/api/batches/{id}/matches` | All matches with confidence bands |
| `GET` | `/api/batches/{id}/exceptions` | Unresolved records with reasons |
| `GET` | `/api/batches/{id}/evaluate` | Precision/recall vs ground truth |
| `GET` | `/api/matches/{id}/audit` | Full audit trail for one match |
| `POST` | `/api/matches/{id}/review` | Human accept/reject action |
| `GET/POST` | `/api/config/thresholds` | Read/update confidence thresholds |
| `POST` | `/api/batches/{id}/retry-llm` | Re-run LLM for pending records |
| `GET` | `/health` | Atlas connectivity check |

---

## Data Model (key entities)

```
Invoice ──< MatchLineItem >── BankTransaction
              │
            Match ──< AuditLogEntry
              │
        GroundTruthLabel (eval only)
```

Every `Match` stores: `confidence_score`, `confidence_band`, `explanation_text`, `explanation_source`, the threshold snapshot in effect at run time, and a `pending_llm_enrichment` flag if both LLM providers were exhausted.

Every `AuditLogEntry` stores: `pass_name`, `score_delta`, `reasoning_text`, `raw_llm_response` (full JSON), `llm_provider` (`gemini`/`groq`/`None`).

---

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entrypoint
│   │   ├── core/                      # Config + DB init
│   │   ├── models/                    # Beanie Documents (7 collections)
│   │   ├── api/                       # REST + SSE routes (6 routers)
│   │   ├── engine/
│   │   │   ├── pass1_rules.py         # Exact / formula matching
│   │   │   ├── pass2_fuzzy.py         # rapidfuzz + Gaussian decay
│   │   │   ├── pass3_embedding.py     # sentence-transformers
│   │   │   ├── pass4_split_matcher.py # Subset-sum + symmetric
│   │   │   ├── pass5_llm_adjudicator.py
│   │   │   ├── confidence_scorer.py
│   │   │   ├── orchestrator.py
│   │   │   ├── candidate_filter.py    # Counterparty + date narrowing
│   │   │   ├── hungarian_matcher.py   # Optimal bipartite assignment
│   │   │   ├── benfords_law.py        # Anomaly detection
│   │   │   └── fellegi_sunter.py      # Probabilistic calibration
│   │   ├── llm/
│   │   │   ├── router.py              # Circuit breaker + failover
│   │   │   ├── gemini_provider.py     # Gemini 3.6-flash (REST)
│   │   │   ├── groq_provider.py       # compound-mini + qwen fallback
│   │   │   └── schemas.py             # AdjudicationResponse (Pydantic)
│   │   └── evaluation/
│   │       ├── metrics.py             # Precision/recall (set-level)
│   │       └── calibration.py
│   ├── data/
│   │   └── generate_synthetic_data.py # 15-category chaos injection
│   └── tests/                         # 6 test files, 100+ cases
├── frontend/                          # Next.js 16 App Router
├── test_data/
│   ├── evaluation_batch/              # 71 records + ground truth (seed-42)
│   └── evaluation_batch_holdout/      # 64 records + ground truth (holdout)
├── .env.example                       # Copy to .env and fill secrets
├── docker-compose.yml
└── AI_Finance_Controller_Build_Plan.md
```

---

## Known Limitations (scope boundaries per build plan §1.2)

- **INR only** — no multi-currency/FX in v1.
- **Structured input only** — CSV/JSON upload; no OCR on scanned documents.
- **Synthetic data only** — does not integrate with live bank APIs or Razorpay production data.
- **No GST filing** — produces a reconciliation view; does not push to GSTN/Tally.
- **3-transaction split gating** — split-payment groups of 3+ transactions that score ≥ 85 can reach auto_accept. The build plan recommends gating these to review; this is a known safety gap.
- **Threshold re-bucketing** — adjusting the confidence slider updates the config but does not re-bucket existing match scores in-place without a re-run.
- **LLM provider availability** — `gemini-3.6-flash` intermittently returns HTTP 503 under batched load on the free tier. The router falls over to Groq automatically; accuracy is unaffected.

---

## Security

- No real financial data anywhere — synthetic only.
- API keys are backend-only: never sent to the browser, never committed to the repo (`.env.example` is committed; `.env` is in `.gitignore`).
- Bank narration text is wrapped in `<<NARRATION_START>>` / `<<NARRATION_END>>` delimiters before being passed to any LLM to guard against prompt injection.
- LLM confidence delta is server-side clamped to ±20 regardless of model output.
