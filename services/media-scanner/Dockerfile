FROM node:22-bookworm-slim
WORKDIR /scanner
ENV NODE_ENV=production PORT=8080 TZ=UTC
COPY --chown=node:node services/media-scanner/server.mjs services/media-scanner/clamd.mjs ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/ready',{headers:{Authorization:'Bearer '+process.env.SCANNER_TOKEN},signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
