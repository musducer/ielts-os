FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Install system dependencies: ffmpeg for audio processing, curl/ca-certificates for secure requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt uvicorn[standard] imageio-ffmpeg

# Copy application code
COPY api ./api
COPY exam_generator ./exam_generator

# Expose Cloud Run port
EXPOSE 8080

# Run with uvicorn listening on 0.0.0.0:${PORT:-8080}
CMD ["sh", "-c", "exec uvicorn api.index:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2"]
