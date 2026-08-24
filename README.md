# ReconAI — Reconciliation Engine

> **Razorpay AI Buildathon — Track 04 (AI Finance Controller)**
> A confidence-scored, GST/TDS-aware reconciliation agent for Indian SMEs.

---

## What it does

Given a batch of bank transactions and invoices for an Indian SME merchant, ReconAI:

1. Matches each bank transaction to the invoice(s) it settles across 5 passes (rules → fuzzy → embeddings → subset-sum split → LLM adjudication).
2. Correctly accounts for Indian finance rules: GST components, TDS deductions, payment gateway fees, and rounding conventions.
3. Assigns every match a **confidence score** with a human-readable explanation.
4. Auto-accepts high-confidence matches, queues medium-confidence for review, and reports exceptions with honest reasons.
5. Produces measurable precision/recall against labeled ground truth, with per-case-category breakdown.
6. Maintains a full audit trail of every decision.

---

## Architecture

```
Next.js Frontend  →  FastAPI Backend  →  MongoDB Atlas
                           ↓
               5-pass matching engine:
               Pass 1: Exact / Rules
               Pass 2: Fuzzy (rapidfuzz)
               Pass 3: Semantic embeddings (sentence-transformers)
               Pass 4: Subset-sum split / batch matcher
               Pass 5: LLM adjudication (Gemini → Groq failover)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI (Python 3.11), Uvicorn |
| Database | MongoDB Atlas M0 (cloud-hosted, free tier) |
| ODM | Beanie (async, Pydantic v2 native) |
| Matching | rapidfuzz, sentence-transformers (all-MiniLM-L6-v2) |
| LLM Primary | Gemini 2.5 Flash-Lite |
| LLM Fallback | Groq Llama 3.3 70B Versatile |

---

## Local Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- A free [MongoDB Atlas](https://cloud.mongodb.com) M0 cluster

### 1. Clone and configure environment

```bash
git clone <repo-url>
cd Milaan
cp .env.example .env
# Fill in MONGODB_URI, GEMINI_API_KEY, GROQ_API_KEY in .env
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Verify Atlas is connected:
```bash
curl http://localhost:8000/health
# Expected: {"status":"ok","atlas":"connected",...}
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### 4. Docker (optional)

```bash
# From repo root
docker-compose up --build
```

---

## Known Limitations (scope boundaries)

- **INR only** — no multi-currency/FX reconciliation in v1.
- **Structured input only** — CSV/JSON upload; no OCR on scanned documents.
- **Synthetic data only** — does not integrate with live bank APIs or live Razorpay production data.
- **No GST filing** — produces a reconciliation view; does not push entries to GSTN/Tally.

---

## Metrics

*Will be populated after evaluation run on the synthetic batch.*

| Metric | Target | Actual |
|---|---|---|
| Overall match rate | ≥ 90% | — |
| Precision (auto-accept) | ≥ 95% | — |
| Recall | ≥ 90% | — |
| Split detection accuracy | ≥ 80% | — |
| Exception list completeness | 100% | — |

---

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entrypoint
│   │   ├── core/                # Config + DB init
│   │   ├── models/              # Beanie Document models
│   │   ├── api/                 # REST + SSE routes
│   │   ├── engine/              # 5-pass matching pipeline
│   │   ├── llm/                 # Gemini + Groq router
│   │   └── evaluation/          # Precision/recall metrics
│   ├── data/                    # Synthetic data generator
│   └── tests/
├── frontend/                    # Next.js app
├── .env.example                 # Copy to .env and fill in secrets
└── docker-compose.yml
```
