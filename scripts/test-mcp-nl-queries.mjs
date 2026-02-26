#!/usr/bin/env node
/**
 * MCP natural-language query test (API-driven).
 *
 * Sends 10–12 simple-English queries to the kubilitics-ai WebSocket chat
 * (/ws/chat), which uses MCP observation/analysis tools against the cluster.
 * Covers 3–4 namespaces. Requires:
 *   - kubilitics-ai server running (default http://localhost:8081)
 *   - kubilitics-backend running and connected to a cluster
 *   - LLM configured in AI server (OpenAI/Anthropic/Ollama)
 *
 * Usage:
 *   cd scripts && npm install && node test-mcp-nl-queries.mjs
 *   AI_WS_URL=ws://localhost:8081 node test-mcp-nl-queries.mjs
 *
 * Env:
 *   AI_WS_URL   WebSocket URL (default ws://localhost:8081/ws/chat)
 *   NAMESPACES  Comma-separated namespaces (default default,kube-system,kube-public)
 */

import WebSocket from 'ws';

const AI_WS_URL = process.env.AI_WS_URL || 'ws://localhost:8081/ws/chat';
const NAMESPACES = (process.env.NAMESPACES || 'default,kube-system,kube-public').split(',').map((s) => s.trim());
const DELAY_MS = parseInt(process.env.DELAY_MS || '2000', 10) || 0; // delay between queries to avoid LLM rate limits

// 10–12 test queries across 3–4 namespaces (simple English)
const TEST_QUERIES = [
  // Count & list
  `How many pods are there in the ${NAMESPACES[0]} namespace?`,
  `What are the pod names in the ${NAMESPACES[0]} namespace?`,
  `List pods in the ${NAMESPACES[1]} namespace.`,
  // Health / failed
  `Are there any pods in failed state in ${NAMESPACES[0]}?`,
  `Are there any pods in failed or pending state in ${NAMESPACES[1]}?`,
  // Top resource usage (cluster)
  `Give me the list of top 5 pods taking more memory and CPU in the cluster.`,
  // Top resource usage (namespace)
  `Give me the list of top 5 pods taking more memory and CPU in the ${NAMESPACES[0]} namespace.`,
  // Restarts and logs
  `Are there any restarts recently for any pods? If yes, check logs and tell why it happened.`,
  // Extra namespace
  ...(NAMESPACES[2]
    ? [
        `How many pods are in the ${NAMESPACES[2]} namespace?`,
        `What are the pod names in ${NAMESPACES[2]}?`,
      ]
    : []),
  // Cluster overview
  `How is the cluster doing? Give a short overview.`,
  `Are there any pods in CrashLoopBackOff or Error state?`,
];

function sendMessage(ws, text) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timeout = setTimeout(() => {
      reject(new Error('Response timeout (90s)'));
    }, 90000);

    const onMessage = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text' && msg.content) chunks.push(msg.content);
        if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          reject(new Error(msg.error || 'Server error'));
        }
        if (msg.type === 'complete') {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          resolve(chunks.join(''));
        }
      } catch (e) {
        // ignore non-JSON (e.g. heartbeat)
      }
    };

    ws.on('message', onMessage);
    ws.send(
      JSON.stringify({
        messages: [{ role: 'user', content: text }],
        stream: true,
      }),
      (err) => {
        if (err) {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          reject(err);
        }
      }
    );
  });
}

async function run() {
  console.log('MCP natural-language query test');
  console.log('WebSocket URL:', AI_WS_URL);
  console.log('Namespaces:', NAMESPACES.join(', '));
  console.log('Queries:', TEST_QUERIES.length);
  console.log('---');

  const ws = new WebSocket(AI_WS_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', (err) => reject(new Error(`WebSocket connection failed: ${err.message}`)));
    ws.on('close', (code, reason) => {
      if (code !== 1000) reject(new Error(`WebSocket closed: ${code} ${reason}`));
    });
  });

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const q = TEST_QUERIES[i];
    const n = i + 1;
    process.stdout.write(`[${n}/${TEST_QUERIES.length}] ${q.slice(0, 60)}${q.length > 60 ? '...' : ''} ... `);
    try {
      const answer = await sendMessage(ws, q);
      const preview = answer.trim().slice(0, 120);
      console.log('OK');
      console.log(`    → ${preview}${answer.length > 120 ? '...' : ''}`);
      passed++;
    } catch (err) {
      console.log('FAIL');
      console.log(`    → ${err.message}`);
      failed++;
    }
    if (DELAY_MS > 0 && i < TEST_QUERIES.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  ws.close();
  console.log('---');
  console.log(`Done: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
