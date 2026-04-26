#!/usr/bin/env node
// dev-preflight.mjs — clear stale dev processes before `cargo tauri dev`.
//
// Cross-platform: macOS, Linux, Windows. Node is already a project dependency
// (kubilitics-frontend), so no extra tooling required.
//
// Why: Kubilitics binds fixed ports (Headlamp-style fail-loud — see
// kubilitics-desktop/src-tauri/src/sidecar.rs). If a previous `cargo tauri dev`
// crashed, its kubilitics-backend / kubilitics-ai-server / vite child can be
// left holding 8190 / 8081 / 5173 / 50061. Without this preflight, the next
// `cargo tauri dev` refuses to start the sidecar with a port-conflict error.
//
// Wired into tauri.conf.json's beforeDevCommand. NOT beforeBuildCommand —
// never kill processes during a release build, and not needed in-cluster
// where the binary is the only process in its container.

import net from 'node:net';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

// 8190  — kubilitics-backend (HTTP)
// 8081  — kubilitics-ai-server (HTTP)
// 50061 — kubilitics-ai-server (gRPC)
// 5173  — Vite dev server (frontend)
const PORTS = [8190, 8081, 50061, 5173];

const isWindows = platform() === 'win32';

/** Try to bind 127.0.0.1:port. Returns true if the port is free. */
function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** Find PIDs listening on `port`. Best-effort — returns [] if tools missing. */
function pidsOn(port) {
  try {
    if (isWindows) {
      // netstat -ano output rows:
      //   TCP    0.0.0.0:8190     0.0.0.0:0    LISTENING   12345
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('TCP') || !trimmed.includes('LISTENING')) continue;
        const cols = trimmed.split(/\s+/);
        if (cols.length >= 5 && cols[1].endsWith(`:${port}`)) {
          pids.add(cols[4]);
        }
      }
      return [...pids];
    }
    // macOS / Linux
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      if (isWindows) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
    } catch {
      // already gone, or permission denied — continue. The Rust fail-loud
      // check will produce a clear error if a port is still held.
    }
  }
}

async function main() {
  for (const port of PORTS) {
    if (await isFree(port)) continue;
    const pids = pidsOn(port);
    if (pids.length === 0) {
      console.error(`dev-preflight: :${port} held by an unknown process — leaving alone`);
      continue;
    }
    console.error(`dev-preflight: freeing :${port} (PIDs: ${pids.join(' ')})`);
    killPids(pids);
  }
  // Brief pause so the kernel actually releases sockets before the sidecar
  // tries to bind. Without this we sometimes still see TIME_WAIT.
  await new Promise((r) => setTimeout(r, 300));
}

main().catch((err) => {
  // Never block dev startup on a preflight failure — the Rust sidecar will
  // emit its own fail-loud message if a port is still held.
  console.error(`dev-preflight: non-fatal error: ${err?.message || err}`);
});
