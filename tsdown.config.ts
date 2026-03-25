import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/livekit': 'src/adapters/livekit.ts',
    'adapters/raw': 'src/adapters/raw.ts',
    detect: 'src/detect.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['livekit-client'],
})
