# Build from the repo root:  docker build -f apps/pipecat/Dockerfile .
#
# Python lives in a container precisely so it stays out of the pnpm workspace:
# the rest of this repo is TypeScript, and a second language in the monorepo
# would mean a second toolchain everywhere. Note the constraint is about the
# WORKSPACE, not about Python — anything Python this service needs belongs in
# here, where the toolchain already exists.
FROM python:3.12-slim

WORKDIR /app

# Silero ships as ONNX and needs nothing exotic, but the webrtc stack wants a
# compiler for its native bits.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY apps/pipecat/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The prompt is NOT copied in. It used to be — this image carried
# apps/agent/src/prompt.ts and bot.py string-parsed it at import — which worked
# only while the prompt was a constant. It is composed per driver now, so the
# container fetches it from /api/realtime/session at connect time instead.
COPY apps/pipecat/bot.py /app/apps/pipecat/bot.py

# Not root, matching the uid-1001 convention of the web and worker images.
# This container holds live participant audio in memory and writes nothing to
# disk, so it needs no ownership anywhere — just the least privilege it can
# run with.
RUN useradd --system --uid 1001 --create-home pipecat
USER 1001

EXPOSE 7860
CMD ["python", "apps/pipecat/bot.py"]
