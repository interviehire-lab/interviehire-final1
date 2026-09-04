FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Uploaded files are temporary container data. Text needed by downstream
# analysis is persisted in Postgres by the application; mount a volume here if
# the original files also need to survive container replacement.
RUN mkdir -p uploads/jd uploads/resumes uploads/attachments \
    && addgroup --system app \
    && adduser --system --ingroup app app \
    && chown -R app:app /app \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.getenv('PORT', '8000')}/\", timeout=3)" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
