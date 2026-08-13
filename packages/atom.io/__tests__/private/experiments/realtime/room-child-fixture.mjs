const mode = process.argv[2] ?? `normal`
let pending = ``

const write = (value) => process.stdout.write(JSON.stringify(value) + `\x03`)

process.stdin.setEncoding(`utf8`)
process.stdin.on(`data`, (chunk) => {
	pending += chunk
	let boundary = pending.indexOf(`\x03`)
	while (boundary !== -1) {
		const frame = pending.slice(0, boundary)
		pending = pending.slice(boundary + 1)
		try {
			const [event, ...args] = JSON.parse(frame)
			if (event === `exit`) {
				if (mode !== `stubborn`) process.exit(0)
			} else if (event.startsWith(`user::`)) {
				write([event, ...args])
			}
		} catch {
			// The production decoder owns malformed diagnostics; this fixture stays inert.
		}
		boundary = pending.indexOf(`\x03`)
	}
})

if (mode === `stubborn`) process.on(`SIGTERM`, () => {})
if (mode !== `never-ready`) {
	process.stdout.write(
		`${JSON.stringify(`ALIVE`)}\x03${JSON.stringify([`boot`, mode])}\x03`,
	)
}
if (mode === `crash`) setTimeout(() => process.exit(1), 25)
