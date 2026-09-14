import { stripVTControlCharacters } from "node:util"

import { spawn } from "bun"

type Step = { waitFor: string; input: string }

const [stepsJson, ...command] = process.argv.slice(2)
if (!stepsJson || command.length === 0)
	throw new Error(`Expected steps and a command`)
const steps = JSON.parse(stepsJson) as Step[]
const decoder = new TextDecoder()
const closed = Promise.withResolvers<void>()
let transcript = ``
let stepIndex = 0
let observedThrough = 0
let timedOut = false

const child = spawn(command, {
	terminal: {
		cols: 120,
		rows: 40,
		data(terminal, data) {
			transcript += decoder.decode(data, { stream: true })
			const output = stripVTControlCharacters(transcript)
			const step = steps[stepIndex]
			if (step && output.slice(observedThrough).includes(step.waitFor)) {
				observedThrough = output.length
				stepIndex++
				terminal.write(step.input)
			}
		},
		exit() {
			closed.resolve()
		},
	},
})

const timeout = setTimeout(() => {
	timedOut = true
	child.kill()
	child.terminal?.close()
	closed.resolve()
}, 8_000)

try {
	const exitCode = await child.exited
	await closed.promise
	const output = stripVTControlCharacters(transcript)
	if (timedOut || stepIndex !== steps.length) {
		throw new Error(
			`Terminal stopped at step ${stepIndex}/${steps.length}:\n${output}`,
		)
	}
	process.stdout.write(JSON.stringify({ exitCode, output }))
} finally {
	clearTimeout(timeout)
	child.terminal?.close()
}
