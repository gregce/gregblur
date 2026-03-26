import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const createdPaths: string[] = []

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  createdPaths.push(dir)
  return dir
}

function createRepoTempDir(prefix: string): string {
  const dir = mkdtempSync(join(repoRoot, prefix))
  createdPaths.push(dir)
  return dir
}

function writeFixtureFile(dir: string, relativePath: string, contents: string): void {
  writeFileSync(join(dir, relativePath), contents)
}

function buildTarball(): string {
  run('npm', ['run', 'build'], repoRoot)
  const packJson = run('npm', ['pack', '--json', '--ignore-scripts'], repoRoot)
  const [{ filename }] = JSON.parse(packJson) as Array<{ filename: string }>
  const tarballPath = join(repoRoot, filename)
  createdPaths.push(tarballPath)
  return tarballPath
}

function installFixturePackage(dir: string, tarballPath: string): void {
  writeFixtureFile(
    dir,
    'package.json',
    JSON.stringify(
      {
        name: 'gregblur-smoke-fixture',
        private: true,
        type: 'module',
      },
      null,
      2,
    ),
  )

  run('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-save', tarballPath], dir)
}

function typecheckFixture(dir: string): void {
  writeFixtureFile(
    dir,
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          lib: ['dom', 'es2022'],
          noEmit: true,
        },
      },
      null,
      2,
    ),
  )

  run(process.execPath, [tscBin, '--project', 'tsconfig.json'], dir)
}

function importFixtureEntrypoints(dir: string): string {
  return run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "const modules = ['gregblur', 'gregblur/raw', 'gregblur/detect', 'gregblur/livekit'];",
        'await Promise.all(modules.map((specifier) => import(specifier)));',
        "process.stdout.write('ok');",
      ].join(' '),
    ],
    dir,
  )
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop()
    if (path && existsSync(path)) {
      rmSync(path, {
        force: true,
        recursive: true,
      })
    }
  }
})

describe.sequential('packed package smoke', () => {
  it('installs from the tarball and supports root/raw/detect consumption without ambient workspace files', () => {
    const tarballPath = buildTarball()
    const fixtureDir = createTempDir('gregblur-smoke-core-')
    installFixturePackage(fixtureDir, tarballPath)

    writeFixtureFile(
      fixtureDir,
      'index.ts',
      [
        "import { createGregblurPipeline, createMediaPipeProvider } from 'gregblur'",
        "import { createRawBlurProcessor } from 'gregblur/raw'",
        "import { isBlurSupported } from 'gregblur/detect'",
        '',
        'const provider = createMediaPipeProvider()',
        'const pipeline = createGregblurPipeline(provider, { blurRadius: 12 })',
        'const processor = createRawBlurProcessor({ initialEnabled: false })',
        '',
        'void pipeline',
        'void processor',
        'void isBlurSupported()',
      ].join('\n'),
    )

    typecheckFixture(fixtureDir)

    const packageJson = JSON.parse(
      readFileSync(join(fixtureDir, 'node_modules/gregblur/package.json'), 'utf8'),
    ) as { files?: string[] }
    expect(packageJson.files).toEqual(['dist', 'README.md', 'LICENSE'])
    expect(importFixtureEntrypoints(fixtureDir)).toBe('ok')
  }, 30000)

  it('ships type declarations that support the LiveKit entrypoint for consumers', () => {
    const tarballPath = buildTarball()
    const fixtureDir = createRepoTempDir('.gregblur-smoke-livekit-')
    installFixturePackage(fixtureDir, tarballPath)

    writeFixtureFile(
      fixtureDir,
      'index.ts',
      [
        "import { createLiveKitBlurProcessor } from 'gregblur/livekit'",
        '',
        'const processor = createLiveKitBlurProcessor({ blurRadius: 18 })',
        'void processor.processedTrack',
      ].join('\n'),
    )

    typecheckFixture(fixtureDir)
    expect(importFixtureEntrypoints(fixtureDir)).toBe('ok')
  }, 30000)
})
