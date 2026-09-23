import { structuredPatch } from 'diff'

export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export function createStructuredPatch(filePath: string, before: string, after: string): PatchHunk[] {
  return structuredPatch(filePath, filePath, before, after, '', '').hunks.map(hunk => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }))
}

export function formatUnifiedDiff(filePath: string, hunks: PatchHunk[]): string {
  const relative = filePath.replace(/\\/g, '/')
  const lines = [`--- a/${relative}`, `+++ b/${relative}`]
  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      lines.push(line)
    }
  }
  return lines.join('\n')
}

/**
 * Summarize the changed lines (removed `-` and added `+`) into a compact
 * "what changed" preview, omitting hunk headers and context lines so the
 * change is obvious even when the full diff is collapsed.
 */
export function formatChangePreview(hunks: PatchHunk[]): string[] {
  const preview: string[] = []
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') || line.startsWith('-')) {
        preview.push(line)
      }
    }
  }
  return preview
}

export function formatFileChangeMessage(
  filePath: string,
  before: string,
  after: string,
  verb: 'updated' | 'created',
  hunks = createStructuredPatch(filePath, before, after),
): string {
  const fileHeader = `File: ${filePath}`
  if (verb === 'created') {
    return hunks.length === 0 ? fileHeader : `${fileHeader}\n\n\`\`\`diff\n${formatUnifiedDiff(filePath, hunks)}\n\`\`\``
  }
  if (hunks.length === 0) return `The file ${filePath} has been updated successfully.`
  const preview = formatChangePreview(hunks)
  const previewBlock = preview.length > 0
    ? `\`\`\`diff\n${preview.join('\n')}\n\`\`\``
    : ''
  const fullDiff = `\`\`\`diff\n${formatUnifiedDiff(filePath, hunks)}\n\`\`\``
  return previewBlock ? `${fileHeader}\n${previewBlock}\n\n${fullDiff}` : `${fileHeader}\n${fullDiff}`
}
