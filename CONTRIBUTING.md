# Contributing to gregblur

Thanks for your interest in contributing! This document covers the basics.

## Setup

```zsh
git clone https://github.com/gregce/gregblur.git
cd gregblur
npm install
npm run build
```

## Development

```zsh
npm run dev       # Watch mode — rebuilds on change
npm run check     # TypeScript type checking
npm run lint      # ESLint
npm run format    # Prettier (write)
npm test          # Run tests
```

## Code Style

- **Prettier** formats all code — run `npm run format` before committing
- **ESLint** catches bugs and enforces TypeScript best practices
- Single quotes, no semicolons, trailing commas
- Print width: 100 characters

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Write clear, descriptive commit messages following [Conventional Commits](https://www.conventionalcommits.org/)
3. Add tests for new functionality
4. Make sure `npm run check`, `npm run lint`, and `npm test` all pass
5. Open a PR with a clear description of what and why

## Architecture

See [docs/pipeline.md](docs/pipeline.md) for a detailed walkthrough of the 8-stage GPU pipeline with diagrams.

### Key directories

| Path                | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `src/core/`         | WebGL2 pipeline, shaders, and utilities    |
| `src/segmentation/` | Pluggable segmentation providers           |
| `src/adapters/`     | Framework-specific adapters (LiveKit, raw) |
| `src/detect.ts`     | Browser capability detection               |
| `docs/`             | Architecture docs and diagrams             |
| `demo/`             | Interactive demo playground                |

## Segmentation Providers

The pipeline accepts any `SegmentationProvider` implementation. If you're adding support for a new segmentation backend (ONNX Runtime, TFLite, etc.), implement the interface in `src/segmentation/types.ts` and add a new file alongside `mediapipe.ts`.
