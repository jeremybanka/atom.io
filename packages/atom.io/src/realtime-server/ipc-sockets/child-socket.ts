import type { Readable, Writable } from "node:stream"

import type { Json } from "atom.io/foundations/json"

import type { EventPayload, Events } from "./custom-socket.ts"
import { CustomSocket, isEventPayload } from "./custom-socket.ts"
import { DelimitedJsonCodec, encodeJsonFrame } from "./delimited-json-codec.ts"
import { PROOF_OF_LIFE_SIGNAL } from "./parent-socket.ts"

/* eslint-disable no-console */

export type ChildProcess = {
	pid?: number | undefined
	stdin: Writable
	stdout: Readable
	stderr: Readable
}

export type StderrLog = [`e` | `i` | `w`, ...Json.Array]

const isStderrLog = (value: unknown): value is StderrLog =>
	Array.isArray(value) &&
	(value[0] === `e` || value[0] === `i` || value[0] === `w`)

export class ChildSocket<
	I extends Events,
	O extends Events,
	P extends ChildProcess = ChildProcess,
> extends CustomSocket<I, O> {
	readonly #disposeEffects: (() => void)[] = []
	public id = `#####`
	public readonly ready: Promise<void>

	public proc: P
	public key: string
	public logger: Pick<Console, `error` | `info` | `warn`>

	protected handleLog(log: StderrLog): void {
		const [level, ...rest] = log
		switch (level) {
			case `i`:
				this.logger.info(...rest)
				break
			case `w`:
				this.logger.warn(...rest)
				break
			case `e`:
				this.logger.error(...rest)
				break
		}
	}

	public constructor(
		proc: P,
		key: string,
		logger?: Pick<Console, `error` | `info` | `warn`>,
	) {
		super((event, ...args) => {
			this.proc.stdin.write(encodeJsonFrame([event, ...args]))
			return this
		})

		this.proc = proc
		this.key = key
		this.logger = logger ?? {
			info: (...args: unknown[]) => {
				console.info(this.id, this.key, ...args)
			},
			warn: (...args: unknown[]) => {
				console.warn(this.id, this.key, ...args)
			},
			error: (...args: unknown[]) => {
				console.error(this.id, this.key, ...args)
			},
		}
		let resolveReady: () => void = () => {}
		this.ready = new Promise((resolve) => {
			resolveReady = resolve
		})
		const events = new DelimitedJsonCodec<
			EventPayload<I> | typeof PROOF_OF_LIFE_SIGNAL
		>({
			onMalformed: (frame, error) => {
				this.logger.error(
					`❌ Malformed data received from child process`,
					frame,
					String(error),
				)
			},
			onValue: (value) => {
				if (value === PROOF_OF_LIFE_SIGNAL) {
					resolveReady()
					return
				}
				if (!isEventPayload(value)) {
					this.logger.error(`❌ Invalid event payload from child process`, value)
					return
				}
				this.logger.info(`💸`, `emitted`, value)
				this.handleEvent(...value)
			},
		})
		const logs = new DelimitedJsonCodec<StderrLog>({
			onMalformed: (frame, error) => {
				this.logger.error(
					`❌ Malformed log received from child process`,
					frame,
					String(error),
				)
			},
			onValue: (value) => {
				if (!isStderrLog(value)) {
					this.logger.error(`❌ Invalid log payload from child process`, value)
					return
				}
				this.handleLog(value)
			},
		})
		const handleStdout = (buffer: Buffer): void => {
			events.write(buffer)
		}
		const handleStderr = (buffer: Buffer): void => {
			logs.write(buffer)
		}
		const endEvents = (): void => {
			events.end()
		}
		const endLogs = (): void => {
			logs.end()
		}
		const handleStdinError = (err: { code: string }): void => {
			if (err.code === `EPIPE`) {
				console.error(`EPIPE error during write`, this.proc.stdin)
			}
		}
		this.proc.stdout.on(`data`, handleStdout)
		this.proc.stdout.once(`end`, endEvents)
		this.proc.stderr.on(`data`, handleStderr)
		this.proc.stderr.once(`end`, endLogs)
		this.proc.stdin.once(`error`, handleStdinError)
		this.#disposeEffects.push(
			() => this.proc.stdout.off(`data`, handleStdout),
			() => this.proc.stdout.off(`end`, endEvents),
			() => this.proc.stderr.off(`data`, handleStderr),
			() => this.proc.stderr.off(`end`, endLogs),
			() => this.proc.stdin.off(`error`, handleStdinError),
		)
		if (proc.pid) {
			this.id = proc.pid.toString()
		}
	}

	public dispose(): void {
		for (const dispose of this.#disposeEffects.splice(0)) dispose()
	}
}
