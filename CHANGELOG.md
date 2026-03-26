# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-25

### Added

- Core WebGL2 blur pipeline with 8-stage GPU processing
  - Frame upload and orientation normalisation
  - Confidence mask segmentation via pluggable provider
  - Joint bilateral filter for color-guided edge refinement
  - Temporal EMA blending for flicker reduction
  - Masked downsampling to prevent foreground ghosting
  - Mask-weighted separable Gaussian blur (anti-halo)
  - Foreground-biased smoothstep compositing
- MediaPipe segmentation provider (selfie-multiclass-256 and selfie-segmenter models)
- LiveKit TrackProcessor adapter (`gregblur/livekit`)
- Raw MediaStreamTrack adapter (`gregblur/raw`)
- Browser capability detection (`gregblur/detect`)
- Pipeline architecture documentation with Mermaid diagrams
- Apache-2.0 license
