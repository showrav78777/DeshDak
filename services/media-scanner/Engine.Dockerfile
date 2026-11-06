# Release builds must supply an approved immutable official ClamAV base digest.
ARG CLAMAV_BASE_IMAGE=clamav/clamav:1.4
FROM ${CLAMAV_BASE_IMAGE}
COPY --chmod=0755 services/media-scanner/engine-entrypoint.sh /deshdak-engine-entrypoint
ENTRYPOINT ["/deshdak-engine-entrypoint"]
