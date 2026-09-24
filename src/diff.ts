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
/**
 * Render the changed lines as plain numbered lines (like Read) instead of a
 * ```diff fence, so Claude Code's collapsed preview shows them inline without
 * needing to expand the diff block. Removed lines use the old line number,
 * added lines the new line number, exactly as in a unified diff.
 */
export function formatChangePreviewLines(hunks: PatchHunk[]): string {
  const lines: string[] = []
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue
      if (line.startsWith('-')) {
        lines.push(`${String(oldLine).padStart(6)}\t${line}`)
        oldLine += 1
      } else if (line.startsWith('+')) {
        lines.push(`${String(newLine).padStart(6)}\t${line}`)
        newLine += 1
      } else {
        oldLine += 1
        newLine += 1
      }
    }
  }
  return lines.join('\n')
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
    if (hunks.length === 0) return fileHeader
    const preview = formatChangePreviewLines(hunks)
    const previewBlock = preview.length > 0 ? `\n${preview}` : ''
    return `${fileHeader}${previewBlock}\n\n\`\`\`diff\n${formatUnifiedDiff(filePath, hunks)}\n\`\`\``
  }
  if (hunks.length === 0) return `The file ${filePath} has been updated successfully.`
  const preview = formatChangePreviewLines(hunks)
  const previewBlock = preview.length > 0 ? `\n${preview}` : ''
  const fullDiff = `\`\`\`diff\n${formatUnifiedDiff(filePath, hunks)}\n\`\`\``
  return previewBlock ? `${fileHeader}${previewBlock}\n\n${fullDiff}` : `${fileHeader}\n${fullDiff}`
}
