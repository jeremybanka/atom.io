export function bundleSizeMarkers(marker = `default`): {
	end: string
	start: string
} {
	validateMarker(marker)
	return {
		end: `<!-- bundle-size:${marker}:end -->`,
		start: `<!-- bundle-size:${marker}:start -->`,
	}
}

export function updateGeneratedSection(
	readme: string,
	markdown: string,
	marker?: string,
): string {
	const { end, start } = bundleSizeMarkers(marker)
	const startIndex = readme.indexOf(start)
	const endIndex = readme.indexOf(end)

	if (startIndex === -1 || endIndex === -1) {
		throw new Error(
			`README must contain exactly one ${start} and one ${end} marker.`,
		)
	}
	if (
		readme.slice(startIndex + start.length).includes(start) ||
		readme.slice(endIndex + end.length).includes(end)
	) {
		throw new Error(
			`README must contain exactly one ${start} and one ${end} marker.`,
		)
	}
	if (endIndex < startIndex) {
		throw new Error(`${end} must appear after ${start}.`)
	}

	const contentStart = startIndex + start.length
	return `${readme.slice(0, contentStart)}\n\n${markdown.trim()}\n\n${readme.slice(endIndex)}`
}

function validateMarker(marker: string): void {
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(marker)) {
		throw new Error(
			`Bundle-size marker names may contain letters, numbers, dots, underscores, and hyphens.`,
		)
	}
}
