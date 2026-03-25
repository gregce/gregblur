#!/usr/bin/env node

/**
 * Minimal dev server for the gregblur demo.
 *
 * Serves the repo root so that both demo/index.html and dist/ are accessible.
 * Required because browsers block ES module imports from file:// URLs.
 *
 * Usage:
 *   node demo/serve.mjs          # starts on port 3000
 *   node demo/serve.mjs 8080     # custom port
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = parseInt(process.argv[2] || '3000', 10)
const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}

const server = createServer(async (req, res) => {
  let url = new URL(req.url, `http://localhost:${PORT}`).pathname

  // Default to demo/index.html at root
  if (url === '/') url = '/demo/index.html'

  const filePath = join(ROOT, url)
  const ext = extname(filePath)

  try {
    const data = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      // COOP/COEP omitted — the demo loads MediaPipe from cdn.jsdelivr.net
      // which would be blocked by require-corp. SharedArrayBuffer is not needed.
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`\n  gregblur demo server running at:\n`)
  console.log(`    http://localhost:${PORT}\n`)
  console.log(`  Press Ctrl+C to stop.\n`)
})
