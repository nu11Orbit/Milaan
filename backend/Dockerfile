FROM python:3.11-slim

WORKDIR /app

# ── Step 1: Install CPU-only PyTorch FIRST ────────────────────────────────────
# Must happen before requirements.txt so pip doesn't pull the 2.5GB GPU build.
# CPU-only torch wheel is ~250MB vs ~2.5GB for the CUDA build.
RUN pip install --no-cache-dir \
    torch==2.4.0 \
    --index-url https://download.pytorch.org/whl/cpu

# ── Step 2: Install remaining dependencies ────────────────────────────────────
# sentence-transformers is installed AFTER torch so it uses the CPU build above.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Step 3: Pre-bake the embedding model into the image ──────────────────────
# Downloads all-MiniLM-L6-v2 (~90MB) at build time, not at startup.
# This removes cold-start network dependency and makes startup deterministic.
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
print('Downloading embedding model...'); \
m = SentenceTransformer('all-MiniLM-L6-v2'); \
print('Model cached at:', m._model_card_data); \
print('Done.')"

# ── Step 4: Copy application code ────────────────────────────────────────────
COPY . .

EXPOSE 8000

# Single worker — Render free tier has 0.1 vCPU, multiple workers waste RAM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
