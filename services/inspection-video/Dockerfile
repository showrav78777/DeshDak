ARG NODE_BASE_IMAGE=node:22-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /processor
ENV NODE_ENV=production PORT=8080 TZ=UTC
COPY --chown=node:node services/inspection-video/processor.mjs services/inspection-video/server.mjs ./inspection-video/
COPY --chown=node:node services/media-scanner/clamd.mjs ./media-scanner/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready',{headers:{Authorization:'Bearer '+process.env.VIDEO_PROCESSOR_TOKEN},signal:AbortSignal.timeout(4500)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "inspection-video/server.mjs"]

FROM runtime AS acceptance
COPY --chown=node:node services/inspection-video/acceptance.mjs ./inspection-video/
COPY --chown=node:node src/modules/private-storage/video-processing.ts ./test-client.ts
CMD ["node", "inspection-video/acceptance.mjs"]

# A plain production build must not select the test command by default.
FROM runtime AS production
