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

export function formatFileChangeMessage(
  filePath: string,
  before: string,
  after: string,
  verb: 'updated' | 'created',
  hunks = createStructuredPatch(filePath, before, after),
): string {
  const header = verb === 'created'
    ? `File created successfully at: ${filePath}`
    : `The file ${filePath} has been updated successfully.`
  if (hunks.length === 0) return header
  return `${header}\n\n\`\`\`diff\n${formatUnifiedDiff(filePath, hunks)}\n\`\`\``
}
