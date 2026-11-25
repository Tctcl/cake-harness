/**
 * A later open of the same storage took over writing. This instance's commits are refused for good: its in-memory next
 * ID may collide with what the newer writer mints, and only one writer may append to a Durable log.
 */
export class WriterReplacedError extends Error {
  constructor() {
    super('Another process opened this Postgres storage and is now its only writer; reopen to write again')
    this.name = 'WriterReplacedError'
  }
}
