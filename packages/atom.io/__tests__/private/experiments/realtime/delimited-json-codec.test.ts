import { DelimitedJsonCodec, encodeJsonFrame } from "atom.io/realtime-server"

const splitWithSeed = (input: Buffer, seed: number): Buffer[] => {
	const chunks: Buffer[] = []
	let cursor = 0
	let state = seed
	while (cursor < input.length) {
		state = (state * 1_664_525 + 1_013_904_223) >>> 0
		const size = 1 + (state % 11)
		chunks.push(input.subarray(cursor, Math.min(cursor + size, input.length)))
		cursor += size
	}
	return chunks
}

describe(`DelimitedJsonCodec`, () => {
	test(`decodes multiple frames and split multi-byte delimiters`, () => {
		const values: unknown[] = []
		const codec = new DelimitedJsonCodec({
			delimiter: `<>`,
			onMalformed: vi.fn(),
			onValue: (value) => values.push(value),
		})
		codec.write(`[1]<>[2]<`)
		codec.write(`>[3]<>`)
		expect(values).toEqual([[1], [2], [3]])
	})

	test(`recovers after malformed frames and keeps stream instances independent`, () => {
		const stdout: unknown[] = []
		const stderr: unknown[] = []
		const malformed = vi.fn()
		const stdoutCodec = new DelimitedJsonCodec({
			onMalformed: malformed,
			onValue: (value) => stdout.push(value),
		})
		const stderrCodec = new DelimitedJsonCodec({
			onMalformed: malformed,
			onValue: (value) => stderr.push(value),
		})

		stdoutCodec.write(`{"partial":`)
		stderrCodec.write(encodeJsonFrame([`i`, `separate`]))
		stdoutCodec.write(`true}\x03not-json\x03${encodeJsonFrame([`valid`])}`)

		expect(stdout).toEqual([{ partial: true }, [`valid`]])
		expect(stderr).toEqual([[`i`, `separate`]])
		expect(malformed).toHaveBeenCalledOnce()
	})

	test(`rejects every non-delimited final frame when the stream ends`, () => {
		const malformed = vi.fn()
		const onValue = vi.fn()
		const codec = new DelimitedJsonCodec({
			onMalformed: malformed,
			onValue,
		})
		codec.write(`{"parseable":true}`)
		codec.end()
		expect(malformed).toHaveBeenCalledOnce()
		expect(malformed.mock.calls[0]?.[0]).toBe(`{"parseable":true}`)
		expect(String(malformed.mock.calls[0]?.[1])).toContain(`missing delimiter`)
		expect(onValue).not.toHaveBeenCalled()
	})

	test(`decodes arbitrary chunk boundaries without corrupting UTF-8`, () => {
		const expected = [
			`ALIVE`,
			[`message`, `héllo 🌍`],
			{ nested: [1, true, null, `終`] },
		]
		const framed = Buffer.from(expected.map(encodeJsonFrame).join(``))

		for (let seed = 0; seed < 250; seed++) {
			const actual: unknown[] = []
			const codec = new DelimitedJsonCodec({
				onMalformed: (frame) => {
					throw new Error(`Unexpected malformed frame: ${frame}`)
				},
				onValue: (value) => actual.push(value),
			})
			for (const chunk of splitWithSeed(framed, seed)) codec.write(chunk)
			expect(actual).toEqual(expected)
		}
	})
})
