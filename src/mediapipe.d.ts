/**
 * Minimal type declarations for @mediapipe/tasks-vision.
 *
 * The actual module is loaded dynamically from CDN at runtime — these
 * types allow TypeScript to check our usage without requiring the npm
 * package as a dependency.
 */
declare module '@mediapipe/tasks-vision' {
  export class FilesetResolver {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static forVisionTasks(wasmBasePath: string): Promise<any>
  }

  export class ImageSegmenter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static createFromOptions(fileset: any, options: ImageSegmenterOptions): Promise<ImageSegmenter>

    segmentForVideo(
      source: TexImageSource,
      timestampMs: number,
    ): ImageSegmenterResult

    close(): void
  }

  export interface ImageSegmenterOptions {
    baseOptions: {
      modelAssetPath: string
      delegate?: string
    }
    runningMode: string
    outputCategoryMask: boolean
    outputConfidenceMasks: boolean
    canvas?: HTMLCanvasElement | OffscreenCanvas
  }

  export interface ImageSegmenterResult {
    confidenceMasks?: Array<{
      getAsWebGLTexture(): WebGLTexture
    }>
    close?: () => void
  }
}
