import type { LogLevel } from "atom.io"
import { IMPLICIT } from "atom.io/internal"

/**
 * Set the implicit store's atom.io logger level while running tests.
 *
 * Committed tests should pass `null` so atom.io's internal logs stay silent.
 * Passing `"error"`, `"warn"`, or `"info"` is intentionally a TypeScript error:
 * it still works at runtime for local debugging, but the type error makes the
 * temporary change hard to check in by accident.
 *
 * @example
 * ```ts
 * setTestLogLevel(null)
 * ```
 *
 * @example
 * ```ts
 * // @ts-expect-error Local debugging only. Do not commit.
 * setTestLogLevel("info")
 * ```
 */
export function setTestLogLevel(logLevel: null): void {
	IMPLICIT.STORE.loggers[0].logLevel = logLevel as LogLevel | null
}
