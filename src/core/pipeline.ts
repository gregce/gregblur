/**
 * Core WebGL2 blur pipeline.
 *
 * This is the heart of gregblur: an 8-stage GPU pipeline that takes a
 * TexImageSource (video frame) and a SegmentationProvider, and renders
 * a blurred-background composite to an internal canvas.
 *
 * Pipeline stages (all on GPU via WebGL2):
 *   1. Upload frame → RGBA texture
 *   2. Provider segmentation → confidence mask texture
 *   3. Joint bilateral filter → refine mask edges using frame color
 *   4. Temporal EMA → blend with previous frame's mask (reduce flicker)
 *   5. Masked downsample → half-res background (foreground-weighted)
 *   6. Mask-weighted Gaussian blur → 2-pass separable (no foreground bleed)
 *   7. Composite → mix blurred background with original via smoothstep matte
 *   8. Output → canvas
 */

import type { FBOWithTexture, GregblurOptions, GregblurPipeline } from './types.js'
import type { SegmentationProvider } from '../segmentation/types.js'
import { createProgram, createFullscreenQuad, createFBOWithTexture } from './webgl-utils.js'
import {
  VERTEX_SHADER,
  VERTEX_SHADER_NO_FLIP,
  BILATERAL_FILTER_SHADER,
  TEMPORAL_BLEND_SHADER,
  COPY_SHADER,
  MASKED_DOWNSAMPLE_SHADER,
  MASK_WEIGHTED_BLUR_SHADER,
  COMPOSITE_SHADER,
} from './shaders.js'

function sanitisePositiveNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  return Number.isFinite(value) ? Math.max(minimum, value as number) : fallback
}

function sanitiseInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  const normalised = Number.isFinite(value) ? Math.floor(value as number) : fallback
  return Math.max(minimum, normalised)
}

function sanitiseUnitInterval(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value as number))
}

function getSourceDimensions(source: TexImageSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth,
      height: source.videoHeight,
    }
  }

  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return {
      width: source.displayWidth,
      height: source.displayHeight,
    }
  }

  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return {
      width: source.width,
      height: source.height,
    }
  }

  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    return {
      width: source.width,
      height: source.height,
    }
  }

  return { width: 0, height: 0 }
}

/**
 * Creates the core gregblur pipeline.
 *
 * The pipeline is framework-agnostic — it knows nothing about
 * MediaStreamTrack, LiveKit, or any video framework. You provide a
 * SegmentationProvider and call processFrame() yourself.
 */
export function createGregblurPipeline(
  provider: SegmentationProvider,
  options?: GregblurOptions,
): GregblurPipeline {
  const blurRadius = sanitisePositiveNumber(options?.blurRadius, 25, 1)
  const sigmaSpace = sanitisePositiveNumber(options?.bilateralSigmaSpace, 4.0, 0.001)
  const sigmaColor = sanitisePositiveNumber(options?.bilateralSigmaColor, 0.1, 0.001)
  const downsampleFactor = sanitiseInteger(options?.downsampleFactor, 2, 1)
  const temporalBlendFactor = sanitiseUnitInterval(options?.temporalBlendFactor, 0.24)

  // ── Mutable state ──────────────────────────────────────────────────────

  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
  let gl: WebGL2RenderingContext | null = null
  let quad: WebGLVertexArrayObject | null = null

  // Shader programs
  let bilateralProgram: WebGLProgram | null = null
  let temporalBlendProgram: WebGLProgram | null = null
  let copySourceProgram: WebGLProgram | null = null
  let copyProgram: WebGLProgram | null = null
  let maskedDownsampleProgram: WebGLProgram | null = null
  let maskWeightedBlurProgram: WebGLProgram | null = null
  let compositeProgram: WebGLProgram | null = null

  // Textures
  let frameTexture: WebGLTexture | null = null

  // FBOs
  let frameOrientedFBO: FBOWithTexture | null = null
  let bilateralFBO: FBOWithTexture | null = null
  let temporalFBO: FBOWithTexture | null = null
  let prevMaskFBO: FBOWithTexture | null = null
  let hasPreviousMask = false
  let bgDownFBO: FBOWithTexture | null = null
  let bgBlurPingFBO: FBOWithTexture | null = null
  let bgBlurPongFBO: FBOWithTexture | null = null

  // Dimensions
  let width = 0
  let height = 0
  let bgWidth = 0
  let bgHeight = 0

  // Pipeline control
  let blurEnabled = options?.initialEnabled ?? true

  // ── Internal helpers ───────────────────────────────────────────────────

  function initGLResources(w: number, h: number): void {
    if (!gl) return
    width = w
    height = h
    bgWidth = Math.max(1, Math.floor(w / downsampleFactor))
    bgHeight = Math.max(1, Math.floor(h / downsampleFactor))

    if (canvas) {
      canvas.width = w
      canvas.height = h
    }

    destroyFBOs()

    frameTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    frameOrientedFBO = createFBOWithTexture(gl, w, h)
    bilateralFBO = createFBOWithTexture(gl, w, h)
    temporalFBO = createFBOWithTexture(gl, w, h)
    prevMaskFBO = createFBOWithTexture(gl, w, h)
    hasPreviousMask = false
    bgDownFBO = createFBOWithTexture(gl, bgWidth, bgHeight)
    bgBlurPingFBO = createFBOWithTexture(gl, bgWidth, bgHeight)
    bgBlurPongFBO = createFBOWithTexture(gl, bgWidth, bgHeight)
  }

  function destroyFBOs(): void {
    if (!gl) return
    const fbos = [
      frameOrientedFBO,
      bilateralFBO,
      temporalFBO,
      prevMaskFBO,
      bgDownFBO,
      bgBlurPingFBO,
      bgBlurPongFBO,
    ]
    for (const f of fbos) {
      if (f) {
        gl.deleteFramebuffer(f.fbo)
        gl.deleteTexture(f.texture)
      }
    }
    if (frameTexture) {
      gl.deleteTexture(frameTexture)
      frameTexture = null
    }
    frameOrientedFBO = null
    bilateralFBO = null
    temporalFBO = null
    prevMaskFBO = null
    hasPreviousMask = false
    bgDownFBO = null
    bgBlurPingFBO = null
    bgBlurPongFBO = null
  }

  function drawQuad(): void {
    if (!gl || !quad) return
    gl.bindVertexArray(quad)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  function renderOrientedFrame(): void {
    if (!gl || !copyProgram || !frameOrientedFBO) return

    gl.useProgram(copyProgram)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, frameOrientedFBO.texture)
    gl.uniform1i(gl.getUniformLocation(copyProgram, 'u_texture'), 0)
    drawQuad()
  }

  function destroyInternal(): void {
    try {
      provider.destroy()
    } catch {
      // Ignore provider cleanup errors during shutdown.
    }

    if (gl) {
      destroyFBOs()

      if (bilateralProgram) gl.deleteProgram(bilateralProgram)
      if (temporalBlendProgram) gl.deleteProgram(temporalBlendProgram)
      if (copySourceProgram) gl.deleteProgram(copySourceProgram)
      if (copyProgram) gl.deleteProgram(copyProgram)
      if (maskedDownsampleProgram) gl.deleteProgram(maskedDownsampleProgram)
      if (maskWeightedBlurProgram) gl.deleteProgram(maskWeightedBlurProgram)
      if (compositeProgram) gl.deleteProgram(compositeProgram)

      if (quad) {
        gl.deleteVertexArray(quad)
      }

      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
    }

    bilateralProgram = null
    temporalBlendProgram = null
    copySourceProgram = null
    copyProgram = null
    maskedDownsampleProgram = null
    maskWeightedBlurProgram = null
    compositeProgram = null
    quad = null
    gl = null

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      canvas instanceof HTMLCanvasElement &&
      canvas.dataset.gregblurFallback === 'true'
    ) {
      canvas.remove()
    }
    canvas = null
    width = 0
    height = 0
    bgWidth = 0
    bgHeight = 0
    hasPreviousMask = false
  }

  // ── Per-frame transform ────────────────────────────────────────────────

  function processFrameInternal(source: TexImageSource, timestampMs: number): void {
    if (
      !gl ||
      !frameTexture ||
      !frameOrientedFBO ||
      !bilateralFBO ||
      !temporalFBO ||
      !prevMaskFBO ||
      !bgDownFBO ||
      !bgBlurPingFBO ||
      !bgBlurPongFBO ||
      !bilateralProgram ||
      !temporalBlendProgram ||
      !copySourceProgram ||
      !copyProgram ||
      !maskedDownsampleProgram ||
      !maskWeightedBlurProgram ||
      !compositeProgram
    ) {
      return
    }

    // Handle resolution changes mid-stream
    const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(source)
    if (sourceWidth > 0 && sourceHeight > 0 && (sourceWidth !== width || sourceHeight !== height)) {
      initGLResources(sourceWidth, sourceHeight)
    }

    // 1) Upload frame
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    // Normalize camera frame orientation once. All later passes operate on
    // render-target textures and use the no-flip vertex shader.
    gl.useProgram(copySourceProgram)
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameOrientedFBO.fbo)
    gl.viewport(0, 0, width, height)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, frameTexture)
    gl.uniform1i(gl.getUniformLocation(copySourceProgram, 'u_texture'), 0)
    drawQuad()

    // Fast path when blur is disabled: just output the oriented frame
    if (!blurEnabled) {
      renderOrientedFrame()
      return
    }

    // 2) Run segmentation → confidence mask
    let segmentResult: ReturnType<SegmentationProvider['segment']> | null = null

    try {
      segmentResult = provider.segment(source, timestampMs)
      if (!segmentResult) {
        renderOrientedFrame()
        return
      }

      const bgConfidenceTexture = segmentResult.confidenceTexture

      // 3) Joint bilateral filter: refine mask using frame color as guide
      gl.useProgram(bilateralProgram)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bilateralFBO.fbo)
      gl.viewport(0, 0, width, height)

      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, bgConfidenceTexture)
      gl.uniform1i(gl.getUniformLocation(bilateralProgram, 'u_mask'), 2)

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, frameTexture)
      gl.uniform1i(gl.getUniformLocation(bilateralProgram, 'u_guideFrame'), 1)

      gl.uniform2f(
        gl.getUniformLocation(bilateralProgram, 'u_texelSize'),
        1.0 / width,
        1.0 / height,
      )
      gl.uniform1f(gl.getUniformLocation(bilateralProgram, 'u_sigmaSpace'), sigmaSpace)
      gl.uniform1f(gl.getUniformLocation(bilateralProgram, 'u_sigmaColor'), sigmaColor)
      drawQuad()

      // 4) Temporal smoothing: blend with previous frame's mask
      let finalMaskTexture: WebGLTexture
      if (hasPreviousMask) {
        gl.useProgram(temporalBlendProgram)
        gl.bindFramebuffer(gl.FRAMEBUFFER, temporalFBO.fbo)
        gl.viewport(0, 0, width, height)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, bilateralFBO.texture)
        gl.uniform1i(gl.getUniformLocation(temporalBlendProgram, 'u_currentMask'), 0)

        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, prevMaskFBO.texture)
        gl.uniform1i(gl.getUniformLocation(temporalBlendProgram, 'u_previousMask'), 3)

        gl.uniform1f(
          gl.getUniformLocation(temporalBlendProgram, 'u_blendFactor'),
          temporalBlendFactor,
        )
        drawQuad()

        finalMaskTexture = temporalFBO.texture
      } else {
        finalMaskTexture = bilateralFBO.texture
      }

      // 5) Copy final mask → prevMask for next frame
      gl.useProgram(copyProgram)
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevMaskFBO.fbo)
      gl.viewport(0, 0, width, height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture)
      gl.uniform1i(gl.getUniformLocation(copyProgram, 'u_texture'), 0)
      drawQuad()
      hasPreviousMask = true

      // 6) Downsample frame for background blur
      gl.useProgram(maskedDownsampleProgram)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bgDownFBO.fbo)
      gl.viewport(0, 0, bgWidth, bgHeight)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, frameOrientedFBO.texture)
      gl.uniform1i(gl.getUniformLocation(maskedDownsampleProgram, 'u_texture'), 0)
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture)
      gl.uniform1i(gl.getUniformLocation(maskedDownsampleProgram, 'u_mask'), 4)
      gl.uniform2f(
        gl.getUniformLocation(maskedDownsampleProgram, 'u_sourceTexelSize'),
        1.0 / width,
        1.0 / height,
      )
      drawQuad()

      // 7) Mask-weighted Gaussian blur (2-pass separable)
      gl.useProgram(maskWeightedBlurProgram)
      const uTex = gl.getUniformLocation(maskWeightedBlurProgram, 'u_texture')
      const uMask = gl.getUniformLocation(maskWeightedBlurProgram, 'u_mask')
      const uTexel = gl.getUniformLocation(maskWeightedBlurProgram, 'u_texelSize')
      const uDir = gl.getUniformLocation(maskWeightedBlurProgram, 'u_direction')
      const uRad = gl.getUniformLocation(maskWeightedBlurProgram, 'u_radius')
      const effectiveBlurRadius = Math.max(1, blurRadius / downsampleFactor)

      // Horizontal pass: bgDown → bgBlurPing
      gl.bindFramebuffer(gl.FRAMEBUFFER, bgBlurPingFBO.fbo)
      gl.viewport(0, 0, bgWidth, bgHeight)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, bgDownFBO.texture)
      gl.uniform1i(uTex, 0)
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture)
      gl.uniform1i(uMask, 4)
      gl.uniform2f(uTexel, 1.0 / bgWidth, 1.0 / bgHeight)
      gl.uniform2f(uDir, 1.0, 0.0)
      gl.uniform1f(uRad, effectiveBlurRadius)
      drawQuad()

      // Vertical pass: bgBlurPing → bgBlurPong
      gl.bindFramebuffer(gl.FRAMEBUFFER, bgBlurPongFBO.fbo)
      gl.viewport(0, 0, bgWidth, bgHeight)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, bgBlurPingFBO.texture)
      gl.uniform1i(uTex, 0)
      gl.uniform2f(uDir, 0.0, 1.0)
      drawQuad()

      // 8) Composite: mix blurred background with original frame via mask
      gl.useProgram(compositeProgram)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, bgBlurPongFBO.texture)
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'background'), 0)

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, frameOrientedFBO.texture)
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'frame'), 1)

      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTexture)
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'mask'), 2)

      drawQuad()
    } catch (e) {
      console.warn('[gregblur] Frame processing error:', e)
      renderOrientedFrame()
    } finally {
      // Release provider resources (e.g. MediaPipe mask handles)
      try {
        segmentResult?.close()
      } catch (closeError) {
        console.warn('[gregblur] Failed to release segmentation result:', closeError)
      }
    }
  }

  // ── Public interface ───────────────────────────────────────────────────

  const pipeline: GregblurPipeline = {
    async init(w: number, h: number): Promise<void> {
      if (canvas || gl) {
        destroyInternal()
      }

      // Prefer OffscreenCanvas when Insertable Streams are available
      const g = globalThis as typeof globalThis & {
        MediaStreamTrackProcessor?: unknown
        MediaStreamTrackGenerator?: unknown
      }
      const hasIS =
        typeof g.MediaStreamTrackProcessor === 'function' &&
        typeof g.MediaStreamTrackGenerator === 'function'

      const canUseOffscreenCanvas =
        typeof OffscreenCanvas !== 'undefined' &&
        (hasIS || typeof document === 'undefined')

      if (canUseOffscreenCanvas) {
        canvas = new OffscreenCanvas(w, h)
      } else {
        if (typeof document === 'undefined') {
          throw new Error('[gregblur] HTMLCanvasElement is not available in this environment.')
        }
        canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
      }

      gl = canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        antialias: false,
        desynchronized: true,
      }) as WebGL2RenderingContext | null

      if (!gl) {
        throw new Error('[gregblur] WebGL2 not available.')
      }

      try {
        // Compile shader programs
        bilateralProgram = createProgram(gl, VERTEX_SHADER, BILATERAL_FILTER_SHADER)
        temporalBlendProgram = createProgram(gl, VERTEX_SHADER_NO_FLIP, TEMPORAL_BLEND_SHADER)
        copySourceProgram = createProgram(gl, VERTEX_SHADER, COPY_SHADER)
        copyProgram = createProgram(gl, VERTEX_SHADER_NO_FLIP, COPY_SHADER)
        maskedDownsampleProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          MASKED_DOWNSAMPLE_SHADER,
        )
        maskWeightedBlurProgram = createProgram(
          gl,
          VERTEX_SHADER_NO_FLIP,
          MASK_WEIGHTED_BLUR_SHADER,
        )
        compositeProgram = createProgram(gl, VERTEX_SHADER_NO_FLIP, COMPOSITE_SHADER)

        quad = createFullscreenQuad(gl)
        initGLResources(w, h)

        // Initialise the segmentation provider with the shared canvas/GL context
        await provider.init(canvas)
      } catch (error) {
        destroyInternal()
        throw error
      }
    },

    processFrame(source: TexImageSource, timestampMs: number): void {
      processFrameInternal(source, timestampMs)
    },

    getCanvas(): HTMLCanvasElement | OffscreenCanvas {
      if (!canvas) throw new Error('[gregblur] Pipeline not initialised — call init() first.')
      return canvas
    },

    getGL(): WebGL2RenderingContext | null {
      return gl
    },

    setEnabled(enabled: boolean): void {
      if (blurEnabled !== enabled) {
        hasPreviousMask = false
      }
      blurEnabled = enabled
    },

    isEnabled(): boolean {
      return blurEnabled
    },

    destroy(): void {
      destroyInternal()
    },
  }

  return pipeline
}
