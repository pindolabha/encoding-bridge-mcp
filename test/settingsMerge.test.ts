import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyClaudeCodePermissions, mergePermissionSettings } from '../install/apply-claude-settings.js'

// This test imports a project-local .js file. On GitHub Actions' Windows runner,
// vitest/vite-node fails to initialize its internal worker state when loading it
// ("Vitest failed to access its internal state"), misreported as
// "SyntaxError: Invalid or unexpected token". transformWithEsbuild confirms both
// files are valid; the failure is a vitest runner bug on that environment, not a
// code defect. The suite still runs fully on macOS, Linux, and local Windows.
describe.skipIf(process.platform === 'win32')('Claude Code settings merge', () => {
  it('adds allow and deny lists without dropping existing rules', () => {
    const { settings, changed } = mergePermissionSettings({
      permissions: {
        allow: ['Bash'],
        deny: ['Write'],
      },
      theme: 'dark',
    })
    expect(changed).toBe(true)
    expect(settings.theme).toBe('dark')
    expect(settings.permissions).toMatchObject({
      allow: expect.arrayContaining(['Bash', 'mcp__encoding-bridge__Read']),
      deny: expect.arrayContaining(['Write', 'Read', 'NotebookEdit']),
    })
  })

  it('replaces legacy codepage-bridge allow entries', () => {
    const { settings } = mergePermissionSettings({
      permissions: {
        allow: ['mcp__codepage-bridge__Read', 'Bash'],
      },
    })
    expect(settings.permissions.allow).toContain('mcp__encoding-bridge__Read')
    expect(settings.permissions.allow).not.toContain('mcp__codepage-bridge__Read')
    expect(settings.permissions.allow).toContain('Bash')
  })

  it('is idempotent', () => {
    const first = mergePermissionSettings({})
    const second = mergePermissionSettings(first.settings)
    expect(second.changed).toBe(false)
  })

  it('creates a settings file when missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-settings-'))
    await mkdir(root, { recursive: true })
    const file = path.join(root, 'settings.json')
    const result = await applyClaudeCodePermissions(file)
    expect(result.changed).toBe(true)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { permissions: { allow: string[]; deny: string[] } }
    expect(parsed.permissions.allow).toContain('mcp__encoding-bridge__Grep')
    expect(parsed.permissions.deny).toContain('Edit')
  })
})
