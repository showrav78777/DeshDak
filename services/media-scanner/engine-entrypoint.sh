#!/bin/sh
set -eu

# The preloaded official image can otherwise load old definitions concurrently
# with FreshClam's first update and miss the startup reload notification.
# Complete the tested update before starting either daemon. Failure stops startup.
chown -R clamav:clamav /var/lib/clamav
freshclam --foreground --stdout --user=clamav
exec /init "$@"
