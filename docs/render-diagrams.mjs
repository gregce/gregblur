#!/usr/bin/env node

/**
 * Renders all Mermaid diagrams from pipeline.md into styled SVGs
 * using beautiful-mermaid.
 *
 * Usage:
 *   npm run docs
 *   # or directly:
 *   node docs/render-diagrams.mjs [theme]
 *
 * Themes: tokyo-night (default), github-dark, catppuccin-mocha, nord, dracula, etc.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIAGRAMS_DIR = join(__dirname, 'diagrams')
const PIPELINE_MD = join(__dirname, 'pipeline.md')

async function main() {
  const themeName = process.argv[2] || 'tokyo-night'

  let renderMermaidSVG, THEMES
  try {
    const bm = await import('beautiful-mermaid')
    renderMermaidSVG = bm.renderMermaidSVG
    THEMES = bm.THEMES
  } catch {
    console.error(
      'beautiful-mermaid is not installed. Run:\n  npm install --save-dev beautiful-mermaid',
    )
    process.exit(1)
  }

  const theme = THEMES[themeName]
  if (!theme) {
    console.error(`Unknown theme "${themeName}". Available: ${Object.keys(THEMES).join(', ')}`)
    process.exit(1)
  }

  // Extract all ```mermaid blocks from pipeline.md
  const md = readFileSync(PIPELINE_MD, 'utf-8')
  const mermaidBlockRegex = /```mermaid\n([\s\S]*?)```/g
  const blocks = []
  let match
  while ((match = mermaidBlockRegex.exec(md)) !== null) {
    blocks.push(match[1].trim())
  }

  if (blocks.length === 0) {
    console.error('No mermaid blocks found in pipeline.md')
    process.exit(1)
  }

  // Diagram names matching their order in the document
  const names = [
    'overview',
    'stage-1-upload',
    'stage-2-segmentation',
    'stage-2-mask-values',
    'stage-3-bilateral',
    'stage-3-weights',
    'stage-4-temporal',
    'stage-5-downsample',
    'stage-6-blur',
    'stage-6-weighting',
    'stage-7-composite',
    'stage-8-output',
    'gpu-resource-map',
    'shader-program-map',
  ]

  mkdirSync(DIAGRAMS_DIR, { recursive: true })

  console.log(`Rendering ${blocks.length} diagrams with theme "${themeName}"...\n`)

  for (let i = 0; i < blocks.length; i++) {
    const name = names[i] || `diagram-${i + 1}`
    const filename = `${name}.svg`

    try {
      const svg = renderMermaidSVG(blocks[i], theme, {
        padding: 32,
        nodeSpacing: 20,
        layerSpacing: 36,
      })
      writeFileSync(join(DIAGRAMS_DIR, filename), svg, 'utf-8')
      console.log(`  ✓ ${filename}`)
    } catch (err) {
      console.error(`  ✗ ${filename}: ${err.message}`)
    }
  }

  console.log(`\nDone. SVGs written to docs/diagrams/`)
}

main()
