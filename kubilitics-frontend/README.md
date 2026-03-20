# Kubilitics Frontend

Kubernetes dashboard and cluster management UI.

## Development

**Requirements:** Node.js & npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating))

From the **repo root**, start both backend and frontend so the API proxy can reach the backend:

```sh
make restart
# or: ./scripts/restart.sh
```

Or run them separately: start the backend first on port 819 (`cd kubilitics-backend && go run ./cmd/server`), then in another terminal run `npm run dev`. If your backend runs on a different port, set `VITE_BACKEND_PORT` (e.g. in `.env`: `VITE_BACKEND_PORT=9000`) so the Vite proxy targets it.

```sh
npm install
npm run dev
```

### Why do I see ECONNREFUSED 127.0.0.1:819 in the terminal?

The frontend proxies API and WebSocket traffic to the backend at `127.0.0.1:819`. If the backend is not running, every request fails and Vite logs a proxy error. **The backend must be running** for the app to work.

- **Fix:** From the **repo root** run `make restart` (or `./scripts/restart.sh`). That builds and starts the backend on 819, then starts the frontend. Do not run only `npm run dev` from the frontend folder without starting the backend first.
- **Circuit breaker:** After the first few connection failures, the frontend stops sending requests for 60 seconds so the terminal is not filled with errors. The UI will show "Backend unreachable"; start the backend and the app will recover.

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Build

```sh
npm run build
```

## Test

```sh
npm run test
npm run e2e
```

### Live Pod Terminal E2E (real backend/cluster)

Run the live integration spec only when you have a reachable backend and a known pod:

```sh
PLAYWRIGHT_CLUSTER_ID="<cluster-id>" \
PLAYWRIGHT_POD_NAMESPACE="<namespace>" \
PLAYWRIGHT_POD_NAME="<pod-name>" \
PLAYWRIGHT_BACKEND_BASE_URL="http://localhost:819" \
npx playwright test e2e/pod-terminal-live-backend.spec.ts --config=playwright.config.mjs
```

Optional cluster-shell checks (`kcli`/`kubectl` source switching):

```sh
PLAYWRIGHT_TEST_CLUSTER_SHELL=1 \
PLAYWRIGHT_CLUSTER_ID="<cluster-id>" \
PLAYWRIGHT_POD_NAMESPACE="<namespace>" \
PLAYWRIGHT_POD_NAME="<pod-name>" \
PLAYWRIGHT_BACKEND_BASE_URL="http://localhost:819" \
npx playwright test e2e/pod-terminal-live-backend.spec.ts --config=playwright.config.mjs
```
