import { StringDecoder } from "node:string_decoder"

import type { Json, stringified } from "atom.io/foundations/json"
import { parseJson } from "atom.io/foundations/json"

export const IPC_FRAME_DELIMITER = `\x03`

export type DelimitedJsonCodecOptions<T extends Json.Serializable> = {
	delimiter?: string
	onMalformed: (frame: string, error: unknown) => void
	onValue: (value: T) => void
}

/** Incrementally decodes delimiter-framed JSON without sharing stream state. */
export class DelimitedJsonCodec<T extends Json.Serializable> {
	readonly #decoder = new StringDecoder(`utf8`)
	readonly #delimiter: string
	readonly #onMalformed: (frame: string, error: unknown) => void
	readonly #onValue: (value: T) => void
	#pending = ``

	public constructor({
		delimiter = IPC_FRAME_DELIMITER,
		onMalformed,
		onValue,
	}: DelimitedJsonCodecOptions<T>) {
		if (delimiter.length === 0)
			throw new Error(`Frame delimiter cannot be empty.`)
		this.#delimiter = delimiter
		this.#onMalformed = onMalformed
		this.#onValue = onValue
	}

	public write(chunk: Buffer | string): void {
		this.#pending +=
			typeof chunk === `string` ? chunk : this.#decoder.write(chunk)
		this.#drain()
	}

	public end(chunk?: Buffer | string): void {
		if (chunk !== undefined) this.write(chunk)
		this.#pending += this.#decoder.end()
		this.#drain()
		if (this.#pending.length > 0) {
			const frame = this.#pending
			this.#pending = ``
			this.#onMalformed(
				frame,
				new Error(`Incomplete final frame (missing delimiter).`),
			)
		}
	}

	public get pending(): string {
		return this.#pending
	}

	#decode(frame: string): void {
		if (frame.length === 0) return
		try {
			this.#onValue(parseJson(frame as stringified<T>))
		} catch (error) {
			this.#onMalformed(frame, error)
		}
	}

	#drain(): void {
		let delimiterIndex = this.#pending.indexOf(this.#delimiter)
		while (delimiterIndex !== -1) {
			const frame = this.#pending.slice(0, delimiterIndex)
			this.#pending = this.#pending.slice(
				delimiterIndex + this.#delimiter.length,
			)
			this.#decode(frame)
			delimiterIndex = this.#pending.indexOf(this.#delimiter)
		}
	}
}

export function encodeJsonFrame(value: unknown): string {
	return JSON.stringify(value) + IPC_FRAME_DELIMITER
}
