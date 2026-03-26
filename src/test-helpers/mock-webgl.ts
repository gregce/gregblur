import { vi } from 'vitest'

type FakeProgram = WebGLProgram & { __id: number }

export interface MockWebGLContext extends WebGL2RenderingContext {
  __clearUseProgramCalls(): void
  __getUseProgramIds(): number[]
  __loseContext: ReturnType<typeof vi.fn>
  __setFailProgramId(programId: number | null): void
}

export function createMockWebGLContext(): MockWebGLContext {
  let nextProgramId = 0
  let failProgramId: number | null = null
  const loseContext = vi.fn()
  const useProgram = vi.fn((program: FakeProgram | null) => {
    if (program && failProgramId !== null && program.__id === failProgramId) {
      throw new Error(`Injected useProgram failure for program ${program.__id}`)
    }
  })

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    TRIANGLE_STRIP: 0x0005,
    TEXTURE_2D: 0x0de1,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    TEXTURE4: 0x84c4,
    createShader: vi.fn(() => ({ kind: 'shader' }) as unknown as WebGLShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(
      () =>
        ({
          __id: ++nextProgramId,
          kind: 'program',
        }) as unknown as FakeProgram,
    ),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    detachShader: vi.fn(),
    createVertexArray: vi.fn(() => ({ kind: 'vao' }) as unknown as WebGLVertexArrayObject),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({ kind: 'buffer' }) as unknown as WebGLBuffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    createTexture: vi.fn(() => ({ kind: 'texture' }) as unknown as WebGLTexture),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    deleteTexture: vi.fn(),
    createFramebuffer: vi.fn(() => ({ kind: 'fbo' }) as unknown as WebGLFramebuffer),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    deleteFramebuffer: vi.fn(),
    drawArrays: vi.fn(),
    activeTexture: vi.fn(),
    useProgram,
    viewport: vi.fn(),
    getUniformLocation: vi.fn(
      (_program: WebGLProgram, name: string) => ({ name }) as unknown as WebGLUniformLocation,
    ),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    getExtension: vi.fn((name: string) => {
      if (name === 'WEBGL_lose_context') {
        return { loseContext }
      }
      return null
    }),
    deleteVertexArray: vi.fn(),
  } as unknown as MockWebGLContext

  gl.__clearUseProgramCalls = () => {
    useProgram.mockClear()
  }
  gl.__getUseProgramIds = () =>
    useProgram.mock.calls
      .map(([program]) => program)
      .filter((program): program is FakeProgram => Boolean(program))
      .map((program) => program.__id)
  gl.__loseContext = loseContext
  gl.__setFailProgramId = (programId: number | null) => {
    failProgramId = programId
  }

  return gl
}
