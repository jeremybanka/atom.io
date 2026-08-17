import type { PointXY, SvgDrawingFixture, SvgEdge } from "./svg-editor-state.ts"

const COMMAND_ARITY = {
	C: 6,
	L: 2,
	M: 2,
	V: 1,
	c: 6,
	l: 2,
	m: 2,
	v: 1,
	Z: 0,
	z: 0,
} as const

type SvgCommand = keyof typeof COMMAND_ARITY

const tokenPattern = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu
const separatorPattern = /^[\s,]*$/u

function isCommand(token: string): token is SvgCommand {
	return token in COMMAND_ARITY
}

function instructions(pathData: string): readonly {
	readonly command: SvgCommand
	readonly numbers: readonly number[]
}[] {
	const tokens: string[] = []
	let previousEnd = 0
	for (const match of pathData.matchAll(tokenPattern)) {
		if (!separatorPattern.test(pathData.slice(previousEnd, match.index))) {
			throw new Error(`SVG path data contains an invalid token`)
		}
		tokens.push(match[0])
		previousEnd = match.index + match[0].length
	}
	if (!separatorPattern.test(pathData.slice(previousEnd))) {
		throw new Error(`SVG path data contains an invalid token`)
	}
	const result: { command: SvgCommand; numbers: number[] }[] = []
	let command: SvgCommand | null = null
	let awaitingArguments = false
	let index = 0
	while (index < tokens.length) {
		const token = tokens[index]
		if (isCommand(token)) {
			if (command !== null && awaitingArguments) {
				throw new Error(`SVG path command ${command} is incomplete`)
			}
			command = token
			awaitingArguments = true
			index++
			if (COMMAND_ARITY[command] === 0) {
				result.push({ command, numbers: [] })
				command = null
				awaitingArguments = false
			}
			continue
		}
		if (/^[A-Za-z]$/u.test(token)) {
			throw new Error(`Unsupported SVG path command ${token}`)
		}
		if (command === null) throw new Error(`SVG path data is missing a command`)
		const arity = COMMAND_ARITY[command]
		const numbers = tokens.slice(index, index + arity).map(Number)
		if (
			numbers.length !== arity ||
			numbers.some((number) => !Number.isFinite(number))
		) {
			throw new Error(`SVG path command ${command} is incomplete`)
		}
		result.push({ command, numbers })
		awaitingArguments = false
		index += arity
		if (command === `m`) command = `l`
		if (command === `M`) command = `L`
	}
	if (command !== null && awaitingArguments) {
		throw new Error(`SVG path command ${command} is incomplete`)
	}
	return result
}

/** Parse the deliberately small command subset used by the bundled Preact SVG. */
export function parsePreactLogo(svg: string): SvgDrawingFixture {
	const pathData = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/gu)].map(
		([, data]) => data,
	)
	let subpathOrdinal = 0
	return {
		paths: pathData.map((data, pathOrdinal) => {
			let previous: PointXY = { x: 0, y: 0 }
			let subpathStart: PointXY = previous
			return {
				id: `path${pathOrdinal}`,
				subpaths: instructions(data).map(({ command, numbers }) => {
					let edge: SvgEdge
					let node: PointXY | null
					switch (command) {
						case `m`:
							node = { x: previous.x + numbers[0], y: previous.y + numbers[1] }
							edge = { kind: `move` }
							subpathStart = node
							break
						case `M`:
							node = { x: numbers[0], y: numbers[1] }
							edge = { kind: `move` }
							subpathStart = node
							break
						case `l`:
							node = { x: previous.x + numbers[0], y: previous.y + numbers[1] }
							edge = { kind: `line` }
							break
						case `L`:
							node = { x: numbers[0], y: numbers[1] }
							edge = { kind: `line` }
							break
						case `c`:
							node = { x: previous.x + numbers[4], y: previous.y + numbers[5] }
							edge = {
								c: { x: previous.x + numbers[0], y: previous.y + numbers[1] },
								kind: `cubic`,
								s: { x: previous.x + numbers[2], y: previous.y + numbers[3] },
							}
							break
						case `C`:
							node = { x: numbers[4], y: numbers[5] }
							edge = {
								c: { x: numbers[0], y: numbers[1] },
								kind: `cubic`,
								s: { x: numbers[2], y: numbers[3] },
							}
							break
						case `v`:
							node = { x: previous.x, y: previous.y + numbers[0] }
							edge = { kind: `line` }
							break
						case `V`:
							node = { x: previous.x, y: numbers[0] }
							edge = { kind: `line` }
							break
						case `z`:
						case `Z`:
							node = null
							edge = { kind: `close` }
							previous = subpathStart
					}
					if (node !== null) previous = node
					return { edge, id: `subpath${subpathOrdinal++}`, node }
				}),
			}
		}),
	}
}
