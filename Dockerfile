FROM python:3.12-slim
WORKDIR /app
COPY paysplit ./paysplit
COPY openapi.json ./openapi.json
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 PAYSPLIT_EMBEDDED_WORKER=1 PAYSPLIT_DB=/data/paysplit.db
EXPOSE 8000
CMD ["python", "-m", "paysplit.api"]
