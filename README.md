# gregblur

[![npm version](https://img.shields.io/npm/v/gregblur)](https://www.npmjs.com/package/gregblur)
[![license](https://img.shields.io/npm/l/gregblur)](https://github.com/gregce/gregblur/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/gregblur)](https://bundlephobia.com/package/gregblur)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)

High-quality WebGL2 background blur for video streams.

Implements the full Google Meet technique stack — confidence masks, joint bilateral filtering, mask-weighted Gaussian blur, temporal EMA smoothing, masked downsampling, and foreground-biased compositing — as a standalone, framework-agnostic library.

## Why gregblur?

Most background blur libraries either give you raw segmentation masks (TensorFlow.js) or lock you into a specific video platform (Twilio, LiveKit, Agora). Gregblur sits in the gap: a complete, production-quality blur pipeline that works with any video source.

| Technique               | gregblur | LiveKit OSS | Volcomix | Twilio |
| ----------------------- | -------- | ----------- | -------- | ------ |
| Confidence masks        | Yes      | Yes         | Yes      | Yes    |
| Joint bilateral filter  | Yes      | No          | Yes      | Yes    |
| Temporal smoothing      | Yes      | No          | No       | Yes    |
| Mask-weighted blur      | Yes      | No          | No       | Yes    |
| Masked downsample       | Yes      | No          | No       | No     |
| Foreground-biased matte | Yes      | No          | No       | No     |
| Open source             | Yes      | Yes         | Yes      | No     |
| Framework-agnostic      | Yes      | No          | Yes      | No     |

## Install

```bash
npm install gregblur
```

## Quick Start

### With LiveKit

```typescript
import { createLiveKitBlurProcessor } from 'gregblur/livekit'

const processor = createLiveKitBlurProcessor({
  blurRadius: 25,
  initialEnabled: true,
  segmentationModel: 'selfie-multiclass-256',
})

await track.setProcessor(processor)
```

### With raw MediaStreamTrack

```typescript
import { createRawBlurProcessor } from 'gregblur/raw'

const processor = createRawBlurProcessor({ blurRadius: 25 })
const blurredTrack = await processor.start(cameraTrack)

// Use blurredTrack with any WebRTC connection
peerConnection.addTrack(blurredTrack)
```

### Core pipeline (advanced)

```typescript
import { createGregblurPipeline, createMediaPipeProvider } from 'gregblur'

const provider = createMediaPipeProvider({ model: 'selfie-multiclass-256' })
const pipeline = createGregblurPipeline(provider, { blurRadius: 30 })

await pipeline.init(1280, 720)
pipeline.processFrame(videoElement, performance.now())
const canvas = pipeline.getCanvas()
```

## API

### Entry Points

| Import             | What you get                       |
| ------------------ | ---------------------------------- |
| `gregblur`         | Core pipeline + MediaPipe provider |
| `gregblur/livekit` | LiveKit TrackProcessor adapter     |
| `gregblur/raw`     | Raw MediaStreamTrack processor     |
| `gregblur/detect`  | Browser capability detection       |

### `createGregblurPipeline(provider, options?)`

Creates the core WebGL2 blur pipeline. You manage frame timing yourself.

**Options:**

- `blurRadius` — Gaussian blur radius (default: 25)
- `bilateralSigmaSpace` — Spatial sigma for bilateral filter (default: 4.0)
- `bilateralSigmaColor` — Color sigma for bilateral filter (default: 0.1)
- `initialEnabled` — Start with blur on (default: true)
- `downsampleFactor` — Background resolution divisor (default: 2)
- `temporalBlendFactor` — EMA blend with previous mask (default: 0.24)

### `createMediaPipeProvider(options?)`

Default segmentation provider using MediaPipe's selfie segmentation models.

**Options:**

- `model` — `'selfie-multiclass-256'` or `'selfie-segmenter'` (default: `'selfie-multiclass-256'`)
- `mediapipeVersion` — CDN version (default: `'0.10.14'`)
- `visionBundleUrl` — custom URL for `vision_bundle.mjs` if you self-host MediaPipe
- `wasmBasePath` — Custom WASM path (defaults to jsDelivr CDN)
- `modelUrl` — custom URL for the segmentation model file

### `createLiveKitBlurProcessor(options?)`

Drop-in LiveKit TrackProcessor. Combines the core pipeline with a segmentation provider and track management.

### `createRawBlurProcessor(options?)`

Framework-agnostic processor. Takes a `MediaStreamTrack`, returns a blurred `MediaStreamTrack`.

### `isBlurSupported()`

Checks for WebGL2, WebAssembly, and Insertable Streams / canvas fallback support.

## Browser Support

- Chrome (desktop) — full Insertable Streams path
- Edge (desktop) — full Insertable Streams path
- Safari (desktop) — canvas captureStream fallback
- Firefox — canvas captureStream fallback
- iOS — not supported (no WebGL2 + captureStream combination)

## How It Works

The pipeline processes each video frame through 8 GPU stages:

1. **Upload** — Camera frame to WebGL texture
2. **Segmentation** — MediaPipe produces a soft confidence mask (0.0–1.0)
3. **Bilateral filter** — Refines mask edges using frame color as guide
4. **Temporal blend** — EMA with previous frame's mask (reduces flicker)
5. **Masked downsample** — Half-res with foreground-weighted sampling
6. **Mask-weighted blur** — 2-pass separable Gaussian, foreground suppressed
7. **Composite** — Smoothstep blend with foreground-biased matte
8. **Output** — Rendered to canvas for capture

## Custom Segmentation Providers

Implement the `SegmentationProvider` interface to use your own model:

```typescript
import type { SegmentationProvider } from 'gregblur'

const myProvider: SegmentationProvider = {
  async init(canvas) {
    // Load your model, share the GL context via canvas
  },
  segment(source, timestampMs) {
    // Return { confidenceTexture: WebGLTexture, close(): void }
    // confidenceTexture values: 1.0 = background, 0.0 = person
  },
  destroy() {
    // Cleanup
  },
}
```

## License

MIT
