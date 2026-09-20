const PREFIX = '[noblesee]'

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause ? ` <- ${describeError(error.cause)}` : ''
    return `${error.name}: ${error.message}${cause}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return Object.prototype.toString.call(error)
  }
}

export function logWarn(where: string, detail: unknown): void {
  console.warn(`${PREFIX} ${where} — ${describeError(detail)}`)
}

export function logError(where: string, error: unknown): void {
  console.error(`${PREFIX} ${where} — ${describeError(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
}
