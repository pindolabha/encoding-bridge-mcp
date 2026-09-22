#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ALLOW = [
  'mcp__encoding-bridge__Read',
  'mcp__encoding-bridge__Grep',
  'mcp__encoding-bridge__Edit',
  'mcp__encoding-bridge__Write',
]

const DENY = [
  'Read',
  'Grep',
  'Edit',
  'Write',
  'NotebookEdit',
]

function settingsPath() {
  const override = process.env.CLAUDE_CONFIG_DIR
  const root = override && override.length > 0 ? override : path.join(os.homedir(), '.claude')
  return path.join(root, 'settings.json')
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
}

function mergeUnique(existing) {
  const result = []
  for (const item of existing) {
    if (!result.includes(item)) result.push(item)
  }
  return result
}
export function mergePermissionSettings(current) {
  const settings = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current }
    : {}
  const permissions = settings.permissions && typeof settings.permissions === 'object' && !Array.isArray(settings.permissions)
    ? { ...settings.permissions }
    : {}
  const allow = mergeUnique([...asStringArray(permissions.allow), ...ALLOW])
  const deny = mergeUnique([...asStringArray(permissions.deny), ...DENY])
  const nextPermissions = { ...permissions, allow, deny }
  const before = JSON.stringify(settings.permissions ?? null)
  const after = JSON.stringify(nextPermissions)
  settings.permissions = nextPermissions
  return { settings, changed: before !== after }
}

export async function applyClaudeCodePermissions(file = settingsPath()) {
  let current = {}
  try {
    current = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const { settings, changed } = mergePermissionSettings(current)
  if (changed) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }
  return { file, changed }
}

const invoked = process.argv[1] !== undefined && path.basename(process.argv[1]).includes('apply-claude-settings')
if (invoked) {
  applyClaudeCodePermissions().then(({ file, changed }) => {
    console.log(changed ? `Updated Claude Code permissions in ${file}` : `Claude Code permissions already present in ${file}`)
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
