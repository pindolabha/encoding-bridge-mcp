export function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Tool input must be an object')
  }
}

export function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(input).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`Unknown input field(s): ${unknown.join(', ')}`)
}

export function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

export function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  minimum: number,
): number | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${key} must be an integer greater than or equal to ${minimum}`)
  }
  return value as number
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}
