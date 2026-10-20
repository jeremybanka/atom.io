import type { LogFn, Logger } from "atom.io"

export const nullLog =
	(_logLevel: keyof Logger): LogFn =>
	(_icon, _denomination, _tokenKey, _message, ..._rest) => {}
export const createNullLogger = (): Logger => ({
	error: nullLog(`error`),
	info: nullLog(`info`),
	warn: nullLog(`warn`),
})

export const stdout = (..._: any[]): void => undefined
export const stdout0 = (..._: any[]): void => undefined
export const stdout1 = (..._: any[]): void => undefined
export const stdout2 = (..._: any[]): void => undefined
export const stdout3 = (..._: any[]): void => undefined
