type LogFields = Record<string, string | number | boolean | readonly string[] | null>

const write = (level: 'info' | 'warn' | 'error', event: string, fields: LogFields): void => {
  const at = new Date().toISOString()
  process.stdout.write(`${JSON.stringify({ level, at, event, ...fields })}\n`)
}

/**
 * One logger for the whole process, JSON lines so the backend can read them
 * later without a parser. Nothing here may carry a credential value.
 */
export const log = {
  info: (event: string, fields: LogFields = {}): void => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}): void => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}): void => write('error', event, fields),
}
