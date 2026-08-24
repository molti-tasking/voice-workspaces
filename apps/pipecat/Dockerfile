# Build from the repo root:  docker build -f apps/pipecat/Dockerfile .
#
# Python lives in a container precisely so it stays out of the pnpm workspace:
# the rest of this repo is TypeScript, and a second language in the monorepo
# would mean a second toolchain everywhere.
FROM python:3.12-slim

WORKDIR /app

# Silero ships as ONNX and needs nothing exotic, but the webrtc stack wants a
# compiler for its native bits.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY apps/pipecat/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The prompt is read from the TypeScript source at runtime so the two
# implementations cannot drift; that file has to be present.
COPY apps/agent/src/prompt.ts /app/apps/agent/src/prompt.ts
COPY apps/pipecat/bot.py /app/apps/pipecat/bot.py

EXPOSE 7860
CMD ["python", "apps/pipecat/bot.py"]
