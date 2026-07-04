export type ExhibitReference = {
	region: string | null
	source: string
}

type RegionMarker = {
	kind: `end` | `start`
	name: string
}

type RegionCapture = {
	code: string
	endLine: number
	startLine: number
}

const REGION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function parseExhibitReference(src: string): ExhibitReference {
	const parts = src.split(`#`)
	if (parts.length > 2) {
		throw new Error(`Invalid exhibit source "${src}": use at most one #region.`)
	}

	const source = normalizeExhibitSource(parts[0] ?? ``)
	const region = parts[1] ?? null

	if (source.length === 0) {
		throw new Error(`Invalid exhibit source "${src}": missing source path.`)
	}
	if (region === ``) {
		throw new Error(`Invalid exhibit source "${src}": missing region name.`)
	}
	if (region != null && !REGION_NAME_PATTERN.test(region)) {
		throw new Error(
			`Invalid exhibit source "${src}": region names must match ${REGION_NAME_PATTERN}.`,
		)
	}

	return { region, source }
}

export function normalizeExhibitSource(src: string): string {
	return src.replace(/^\/+/, ``).replace(/^docs\/source\/exhibits\//, ``)
}

export function extractExhibitCode(
	code: string,
	reference: ExhibitReference,
): string {
	if (reference.region == null) {
		return code
	}

	const regions = collectExhibitRegions(code, reference.source)
	const region = regions.get(reference.region)

	if (!region) {
		const available = [...regions.keys()].sort()
		throw new Error(
			[
				`Unknown exhibit region "${reference.region}" in ${reference.source}.`,
				available.length === 0
					? `No regions were declared.`
					: `Available regions: ${available.map((name) => `#${name}`).join(`, `)}.`,
			].join(` `),
		)
	}

	return region.code
}

function collectExhibitRegions(
	code: string,
	source: string,
): Map<string, RegionCapture> {
	const regions = new Map<string, RegionCapture>()
	const lines = code.split(/\r?\n/)
	let active: {
		lines: string[]
		name: string
		startLine: number
	} | null = null

	for (let index = 0; index < lines.length; index++) {
		const lineNumber = index + 1
		const marker = readRegionMarker(lines[index] ?? ``)

		if (!marker) {
			active?.lines.push(lines[index] ?? ``)
			continue
		}

		if (marker.kind === `start`) {
			if (active) {
				throw new Error(
					`Nested exhibit region "${marker.name}" in ${source}:${lineNumber}; "${active.name}" started at line ${active.startLine}.`,
				)
			}
			if (regions.has(marker.name)) {
				const previous = regions.get(marker.name)!
				throw new Error(
					`Duplicate exhibit region "${marker.name}" in ${source}:${lineNumber}; first declared at line ${previous.startLine}.`,
				)
			}
			active = { lines: [], name: marker.name, startLine: lineNumber }
			continue
		}

		if (!active) {
			throw new Error(
				`Unmatched exhibit region end "${marker.name}" in ${source}:${lineNumber}.`,
			)
		}
		if (marker.name !== active.name) {
			throw new Error(
				`Mismatched exhibit region end "${marker.name}" in ${source}:${lineNumber}; expected "${active.name}".`,
			)
		}

		regions.set(active.name, {
			code: trimRegionLines(active.lines).join(`\n`),
			endLine: lineNumber,
			startLine: active.startLine,
		})
		active = null
	}

	if (active) {
		throw new Error(
			`Unclosed exhibit region "${active.name}" in ${source}:${active.startLine}.`,
		)
	}

	return regions
}

function readRegionMarker(line: string): RegionMarker | null {
	let marker = line.trim()

	if (marker.startsWith(`<!--`)) {
		marker = marker.slice(4).trim()
	} else if (marker.startsWith(`//`)) {
		marker = marker.slice(2).trim()
	} else if (marker.startsWith(`#`)) {
		marker = marker.slice(1).trim()
	} else if (marker.startsWith(`--`)) {
		marker = marker.slice(2).trim()
	} else if (marker.startsWith(`/*`)) {
		marker = marker.slice(2).trim()
	} else if (marker.startsWith(`*`)) {
		marker = marker.slice(1).trim()
	} else {
		return null
	}

	if (marker.endsWith(`-->`)) {
		marker = marker.slice(0, -3).trim()
	}
	if (marker.endsWith(`*/`)) {
		marker = marker.slice(0, -2).trim()
	}

	const match = /^@exhibit-region\s+(start|end)\s+(\S+)$/.exec(marker)
	if (!match) {
		return null
	}

	const name = match[2]
	if (!REGION_NAME_PATTERN.test(name)) {
		throw new Error(
			`Invalid exhibit region name "${name}"; names must match ${REGION_NAME_PATTERN}.`,
		)
	}

	return { kind: match[1] as `end` | `start`, name }
}

function trimRegionLines(lines: string[]): string[] {
	const trimmed = trimOuterBlankLines(lines)
	const indent = findSharedIndent(trimmed)
	return indent.length === 0
		? trimmed
		: trimmed.map((line) =>
				line.trim() === `` ? line : line.replace(indent, ``),
			)
}

function trimOuterBlankLines(lines: string[]): string[] {
	let start = 0
	let end = lines.length

	while (start < end && lines[start]?.trim() === ``) {
		start++
	}
	while (end > start && lines[end - 1]?.trim() === ``) {
		end--
	}

	return lines.slice(start, end)
}

function findSharedIndent(lines: string[]): string {
	const indents = lines
		.filter((line) => line.trim() !== ``)
		.map((line) => line.match(/^\s*/)?.[0] ?? ``)

	if (indents.length === 0) {
		return ``
	}

	let shared = indents[0]
	for (const indent of indents.slice(1)) {
		while (!indent.startsWith(shared)) {
			shared = shared.slice(0, -1)
			if (shared.length === 0) {
				return ``
			}
		}
	}
	return shared
}
