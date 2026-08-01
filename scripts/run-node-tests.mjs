import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const [rootDirectory, suffix, ...testArguments] = process.argv.slice(2)

if (!rootDirectory || !suffix) {
  throw new Error(
    'Usage: node scripts/run-node-tests.mjs <root-directory> <file-suffix> [node-test-arguments...]',
  )
}

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

const files = (await collectFiles(rootDirectory))
  .filter((file) => file.endsWith(suffix))
  .sort((left, right) => left.localeCompare(right))

if (files.length === 0) {
  throw new Error(`No ${suffix} files found under ${rootDirectory}`)
}

const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', ...testArguments, ...files],
  { stdio: 'inherit' },
)

child.once('error', (error) => {
  throw error
})

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
