FROM python:3.11-slim

# Install system dependencies including FFmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install python packages
COPY api/requirements.txt /app/api/requirements.txt
RUN pip install --no-cache-dir -r /app/api/requirements.txt

# Scenario seed data must be present or a clean volume seeds zero scenarios.
COPY api /app/api
COPY data/scenarios /app/data/scenarios

# Storage and database live on mounted volumes; create them so the first write
# never fails on a missing parent directory.
RUN mkdir -p /app/storage/raw /app/storage/processed /app/storage/exports /app/data

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# config.py resolves PROJECT_ROOT from its own location, so the database and
# storage land under /app regardless of the working directory.
CMD ["uvicorn", "api.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
