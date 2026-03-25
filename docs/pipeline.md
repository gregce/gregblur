# gregblur Pipeline Architecture

How gregblur transforms a raw camera frame into a professional-looking blurred-background composite — entirely on the GPU via WebGL2.

## Overview

Every video frame passes through 8 GPU stages in a single draw cycle. The pipeline never touches the CPU for pixel work — all compositing, filtering, and blurring happens in fragment shaders operating on WebGL2 framebuffer objects (FBOs).

```mermaid
graph TD
  subgraph pipeline ["gregblur Pipeline"]
    direction TB
    A["1 Upload\nCamera frame → WebGL texture"] --> B["2 Segmentation\nMediaPipe → confidence mask"]
    B --> C["3 Bilateral Filter\nColor-guided edge refinement"]
    C --> D["4 Temporal Blend\nEMA with previous frame's mask"]
    D --> E["5 Masked Downsample\nHalf-res, foreground-weighted"]
    E --> F["6 Mask-Weighted Blur\n2-pass separable Gaussian"]
    F --> G["7 Composite\nSmoothstep blend via matte"]
    G --> H["8 Output\nCanvas → MediaStreamTrack"]
  end

  style A fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style B fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  style C fill:#ec4899,stroke:#be185d,color:#ffffff
  style D fill:#f59e0b,stroke:#d97706,color:#ffffff
  style E fill:#10b981,stroke:#047857,color:#ffffff
  style F fill:#06b6d4,stroke:#0e7490,color:#ffffff
  style G fill:#f43f5e,stroke:#be123c,color:#ffffff
  style H fill:#6366f1,stroke:#4338ca,color:#ffffff
```

## Stage-by-Stage Breakdown

### Stage 1 — Upload

The raw camera frame (from `VideoFrame`, `HTMLVideoElement`, or `HTMLCanvasElement`) is uploaded to a WebGL2 RGBA texture. A copy shader with Y-flip normalises the camera orientation into a consistent coordinate space for all subsequent passes.

```mermaid
graph LR
  subgraph upload ["Stage 1: Upload"]
    direction LR
    CAM["Camera Frame\n(TexImageSource)"] -->|"texImage2D"| FT["frameTexture\n(RGBA)"]
    FT -->|"VERTEX_SHADER\n(Y-flip)"| FOF["frameOrientedFBO\n(normalised)"]
  end

  style CAM fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style FT fill:#60a5fa,stroke:#2563eb,color:#ffffff
  style FOF fill:#93c5fd,stroke:#3b82f6,color:#1e3a5f
```

### Stage 2 — Segmentation

The segmentation provider (MediaPipe by default) analyses the frame and produces a **confidence mask** — a single-channel texture where each pixel is a probability between 0.0 (definitely person) and 1.0 (definitely background).

This is fundamentally different from a binary mask. Confidence values give native soft edges around hair, glasses, and clothing without any post-processing.

```mermaid
graph LR
  subgraph seg ["Stage 2: Segmentation"]
    direction LR
    FRAME["Camera Frame"] -->|"segmentForVideo()"| MP["MediaPipe\nImageSegmenter"]
    MP --> CONF["Confidence Mask\n(WebGL Texture)"]
  end

  subgraph mask_values ["Mask Values"]
    direction TB
    BG["1.0 = Background"] ~~~ MID["0.5 = Uncertain Edge"]
    MID ~~~ FG["0.0 = Person"]
  end

  style FRAME fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style MP fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  style CONF fill:#a78bfa,stroke:#7c3aed,color:#ffffff
  style BG fill:#ef4444,stroke:#b91c1c,color:#ffffff
  style MID fill:#f59e0b,stroke:#d97706,color:#ffffff
  style FG fill:#22c55e,stroke:#15803d,color:#ffffff
```

### Stage 3 — Joint Bilateral Filter

The raw confidence mask has fuzzy, low-resolution edges (MediaPipe runs at 256x256). The bilateral filter uses the **original frame's colour** as a guide signal to snap mask edges to real image boundaries.

Where the image is uniform (wall, desk), the filter smooths the mask. Where there's a real edge (hair against wall, glasses frame), dissimilar colours suppress smoothing and the edge stays sharp.

```mermaid
graph TD
  subgraph bilateral ["Stage 3: Joint Bilateral Filter"]
    direction TB
    RAW_MASK["Raw Confidence Mask\n(bg confidence)"] --> SHADER["BILATERAL_FILTER_SHADER"]
    GUIDE["Original Frame\n(colour guide)"] --> SHADER
    SHADER --> REFINED["Refined Foreground Mask\n(inverted: 1.0 = person)"]
  end

  subgraph weights ["Per-Sample Weighting"]
    direction LR
    SW["Spatial Weight\nexp(−dist²/2σ²_space)"] --- CW["Colour Weight\nexp(−colourDist²/2σ²_colour)"]
    CW --- FW["Final = spatial × colour"]
  end

  style RAW_MASK fill:#8b5cf6,stroke:#6d28d9,color:#ffffff
  style GUIDE fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style SHADER fill:#ec4899,stroke:#be185d,color:#ffffff
  style REFINED fill:#f472b6,stroke:#db2777,color:#ffffff
  style SW fill:#fbbf24,stroke:#d97706,color:#1e3a5f
  style CW fill:#fbbf24,stroke:#d97706,color:#1e3a5f
  style FW fill:#f59e0b,stroke:#b45309,color:#ffffff
```

### Stage 4 — Temporal Blend

Frame-to-frame mask jitter causes visible flickering, especially on profile turns. Temporal blending applies an exponential moving average (EMA): 76% current frame + 24% previous frame.

The previous frame's mask is stored in `prevMaskFBO` and updated every frame.

```mermaid
graph LR
  subgraph temporal ["Stage 4: Temporal EMA"]
    direction LR
    CURR["Current Mask\n(from bilateral)"] --> BLEND["TEMPORAL_BLEND_SHADER\nmix(current, previous, 0.24)"]
    PREV["Previous Mask\n(prevMaskFBO)"] --> BLEND
    BLEND --> FINAL["Stabilised Mask"]
    FINAL -->|"copy"| PREV
  end

  style CURR fill:#ec4899,stroke:#be185d,color:#ffffff
  style PREV fill:#f59e0b,stroke:#d97706,color:#ffffff
  style BLEND fill:#f59e0b,stroke:#b45309,color:#ffffff
  style FINAL fill:#fbbf24,stroke:#92400e,color:#1e3a5f
```

### Stage 5 — Masked Downsample

Before blurring, the frame is downsampled to half resolution. But naive downsampling would bake the subject's pixels into the low-res texels, creating ghosting artifacts.

The masked downsample shader weights each sample by `(1 - foreground)`, so person pixels contribute less to the downsampled background.

```mermaid
graph LR
  subgraph downsample ["Stage 5: Masked Downsample"]
    direction LR
    FULL["Full-Res Frame\n(frameOrientedFBO)"] --> DS["MASKED_DOWNSAMPLE_SHADER\nbgWeight = 1 − smoothstep(0.12, 0.55, fg)"]
    MASK["Foreground Mask"] --> DS
    DS --> HALF["Half-Res Background\n(bgDownFBO)"]
  end

  style FULL fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style MASK fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style DS fill:#10b981,stroke:#047857,color:#ffffff
  style HALF fill:#34d399,stroke:#059669,color:#1e3a5f
```

### Stage 6 — Mask-Weighted Gaussian Blur

This is the key anti-halo technique. A naive Gaussian blur smears foreground pixels into the background, creating a bright "ghost" around the subject.

The mask-weighted blur multiplies each Gaussian sample by `(1 - maskVal)`, suppressing foreground contributions. The blur is separable (horizontal + vertical passes) for O(r) instead of O(r²) samples.

```mermaid
graph TD
  subgraph blur ["Stage 6: Mask-Weighted Blur"]
    direction TB
    HALF["Half-Res Background\n(bgDownFBO)"] --> H_PASS["Horizontal Pass\n→ bgBlurPingFBO"]
    FMASK1["Foreground Mask"] --> H_PASS
    H_PASS --> V_PASS["Vertical Pass\n→ bgBlurPongFBO"]
    FMASK2["Foreground Mask"] --> V_PASS
    V_PASS --> BLURRED["Blurred Background"]
  end

  subgraph weighting ["Per-Sample Weight"]
    direction LR
    GW["Gaussian\nexp(−offset²/2σ²)"] --- MW["Mask\nmax(1 − maskVal, 0.001)"]
    MW --- TW["Total = gauss × mask"]
  end

  style HALF fill:#34d399,stroke:#059669,color:#1e3a5f
  style H_PASS fill:#06b6d4,stroke:#0e7490,color:#ffffff
  style V_PASS fill:#0891b2,stroke:#155e75,color:#ffffff
  style BLURRED fill:#22d3ee,stroke:#0e7490,color:#1e3a5f
  style FMASK1 fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style FMASK2 fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style GW fill:#67e8f9,stroke:#0e7490,color:#1e3a5f
  style MW fill:#67e8f9,stroke:#0e7490,color:#1e3a5f
  style TW fill:#06b6d4,stroke:#155e75,color:#ffffff
```

### Stage 7 — Composite

The final composite mixes the blurred background with the original frame using the foreground mask. The `smoothstep(0.26, 0.72, mask + 0.035)` function creates a clean, tunable soft edge.

The `+0.035` offset is foreground-biased — it preserves ears, temples, and profile edges even when MediaPipe's model is conservative.

```mermaid
graph LR
  subgraph composite ["Stage 7: Composite"]
    direction LR
    BG_BLUR["Blurred Background\n(bgBlurPongFBO)"] --> COMP["COMPOSITE_SHADER\nalpha = smoothstep(0.26, 0.72,\nclamp(mask + 0.035, 0, 1))"]
    ORIG["Original Frame\n(frameOrientedFBO)"] --> COMP
    FMASK["Foreground Mask"] --> COMP
    COMP --> OUT["mix(blurred, original, alpha)"]
  end

  style BG_BLUR fill:#22d3ee,stroke:#0e7490,color:#1e3a5f
  style ORIG fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style FMASK fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style COMP fill:#f43f5e,stroke:#be123c,color:#ffffff
  style OUT fill:#fb7185,stroke:#e11d48,color:#ffffff
```

### Stage 8 — Output

The composited result is rendered to the pipeline's canvas. Two output paths are available:

- **Insertable Streams** (Chrome/Edge): Zero-copy via `TransformStream` — each frame is wrapped in a new `VideoFrame` from the `OffscreenCanvas`
- **Fallback** (Safari/Firefox): The canvas is captured via `captureStream(30)` and the resulting `MediaStreamTrack` is used directly

```mermaid
graph TD
  subgraph output ["Stage 8: Output Paths"]
    direction TB
    CANVAS["Pipeline Canvas\n(WebGL2 output)"] --> IS_CHECK{"Insertable\nStreams?"}
    IS_CHECK -->|"Yes"| IS_PATH["OffscreenCanvas\n→ VideoFrame\n→ TransformStream\n→ TrackGenerator"]
    IS_CHECK -->|"No"| RAF_PATH["HTMLCanvasElement\n→ captureStream(30)\n→ MediaStreamTrack"]
    IS_PATH --> TRACK["Output Track"]
    RAF_PATH --> TRACK
  end

  style CANVAS fill:#6366f1,stroke:#4338ca,color:#ffffff
  style IS_CHECK fill:#a78bfa,stroke:#7c3aed,color:#ffffff
  style IS_PATH fill:#818cf8,stroke:#4f46e5,color:#ffffff
  style RAF_PATH fill:#818cf8,stroke:#4f46e5,color:#ffffff
  style TRACK fill:#4f46e5,stroke:#3730a3,color:#ffffff
```

## GPU Resource Map

All FBOs and textures used in a single frame, showing how data flows between them.

```mermaid
graph TD
  subgraph textures ["Textures & FBOs"]
    direction TB
    FT["frameTexture\n(full-res RGBA)"]
    FOF["frameOrientedFBO\n(full-res, Y-normalised)"]
    BF["bilateralFBO\n(full-res, refined mask)"]
    TF["temporalFBO\n(full-res, blended mask)"]
    PMF["prevMaskFBO\n(full-res, last frame's mask)"]
    BDF["bgDownFBO\n(half-res, downsampled bg)"]
    BPF["bgBlurPingFBO\n(half-res, H-blurred)"]
    BPO["bgBlurPongFBO\n(half-res, final blur)"]
  end

  FT -->|"copy + Y-flip"| FOF
  FOF -->|"bilateral input"| BF
  BF -->|"temporal current"| TF
  PMF -->|"temporal previous"| TF
  TF -->|"copy"| PMF
  FOF -->|"downsample source"| BDF
  BDF -->|"H-blur"| BPF
  BPF -->|"V-blur"| BPO
  BPO -->|"composite bg"| SCREEN["Screen Output\n(null FBO)"]
  FOF -->|"composite fg"| SCREEN
  TF -->|"composite mask"| SCREEN

  style FT fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style FOF fill:#60a5fa,stroke:#2563eb,color:#ffffff
  style BF fill:#ec4899,stroke:#be185d,color:#ffffff
  style TF fill:#f59e0b,stroke:#d97706,color:#ffffff
  style PMF fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style BDF fill:#10b981,stroke:#047857,color:#ffffff
  style BPF fill:#06b6d4,stroke:#0e7490,color:#ffffff
  style BPO fill:#22d3ee,stroke:#0e7490,color:#1e3a5f
  style SCREEN fill:#f43f5e,stroke:#be123c,color:#ffffff
```

## Shader Program Map

Which vertex + fragment shader pairs make up each program, and where each program is used in the pipeline.

```mermaid
graph LR
  subgraph programs ["7 Shader Programs"]
    direction TB
    P1["copySourceProgram\nVERTEX_SHADER + COPY_SHADER"]
    P2["bilateralProgram\nVERTEX_SHADER + BILATERAL_FILTER"]
    P3["temporalBlendProgram\nVS_NO_FLIP + TEMPORAL_BLEND"]
    P4["copyProgram\nVS_NO_FLIP + COPY_SHADER"]
    P5["maskedDownsampleProgram\nVS_NO_FLIP + MASKED_DOWNSAMPLE"]
    P6["maskWeightedBlurProgram\nVS_NO_FLIP + MASK_WEIGHTED_BLUR"]
    P7["compositeProgram\nVS_NO_FLIP + COMPOSITE"]
  end

  P1 -->|"Stage 1"| S1["Upload\n(Y-flip orient)"]
  P2 -->|"Stage 3"| S3["Bilateral Filter"]
  P3 -->|"Stage 4"| S4["Temporal Blend"]
  P4 -->|"Stage 4→5"| S45["Mask Copy"]
  P5 -->|"Stage 5"| S5["Downsample"]
  P6 -->|"Stage 6"| S6["Blur (×2 passes)"]
  P7 -->|"Stage 7"| S7["Composite"]

  style P1 fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style P2 fill:#ec4899,stroke:#be185d,color:#ffffff
  style P3 fill:#f59e0b,stroke:#d97706,color:#ffffff
  style P4 fill:#fbbf24,stroke:#92400e,color:#1e3a5f
  style P5 fill:#10b981,stroke:#047857,color:#ffffff
  style P6 fill:#06b6d4,stroke:#0e7490,color:#ffffff
  style P7 fill:#f43f5e,stroke:#be123c,color:#ffffff
```

## Why Each Stage Matters

| Stage | Without It | With It |
|---|---|---|
| **Bilateral filter** | Fuzzy edges — hair and glasses blend into background | Sharp edges aligned to real image boundaries |
| **Temporal blend** | Visible flickering on every frame, especially profile turns | Smooth, stable mask transitions |
| **Masked downsample** | Subject pixels baked into blur texels → ghosting | Clean background without foreground contamination |
| **Mask-weighted blur** | Bright "halo" around the subject from foreground bleed | Foreground suppressed — no halo artifacts |
| **Foreground bias** | Ears, temples, thin hair lost on profile turns | +0.035 offset preserves conservative model predictions |
| **Smoothstep composite** | Hard, jaggy transition between person and blur | Clean soft edge with tunable falloff |
