// Container HEALTHCHECK: GET /healthz on the local port. No curl in the image.
const port = process.env.LISTEN_PORT ?? '8080';
fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) })
  .then((r) => process.exit(r.ok ? 0 : 1))
  .catch(() => process.exit(1));
