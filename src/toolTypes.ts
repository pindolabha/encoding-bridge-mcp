export interface ReadInput {
  file_path: string
  offset?: number
  limit?: number
  pages?: string
}

export interface EditInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface WriteInput {
  file_path: string
  content: string
}

export interface ScanEncodingsInput {
  path?: string
}

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type ToolContent = TextContent | ImageContent

export interface ToolResponse {
  content: ToolContent[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}
