const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })

const ascii = (code: number): boolean => code <= 0x7f

/** Internal streaming primitive shared by Mosaic Text and its physical index. */
export function visitMosaicTextGraphemes(
	text: string,
	visit: (start: number, end: number) => void,
): void {
	let cursor = 0
	while (cursor < text.length) {
		if (ascii(text.charCodeAt(cursor))) {
			let end = cursor + 1
			while (end < text.length && ascii(text.charCodeAt(end))) end++
			const retained =
				end < text.length &&
				end - cursor >= 2 &&
				text.charCodeAt(end - 2) === 0x0d &&
				text.charCodeAt(end - 1) === 0x0a
					? 2
					: 1
			const fastEnd =
				end === text.length ? end : Math.max(cursor, end - retained)
			while (cursor < fastEnd) {
				const next =
					text.charCodeAt(cursor) === 0x0d &&
					cursor + 1 < fastEnd &&
					text.charCodeAt(cursor + 1) === 0x0a
						? cursor + 2
						: cursor + 1
				visit(cursor, next)
				cursor = next
			}
			if (cursor === text.length) break
		}

		const complexStart = cursor
		let complexEnd = text.length
		for (let index = cursor + 1; index < text.length; index++) {
			const previous = text.charCodeAt(index - 1)
			const current = text.charCodeAt(index)
			if (
				ascii(previous) &&
				ascii(current) &&
				!(previous === 0x0d && current === 0x0a)
			) {
				complexEnd = index
				break
			}
		}
		const complex = text.slice(complexStart, complexEnd)
		for (const { index, segment } of segmenter.segment(complex)) {
			visit(complexStart + index, complexStart + index + segment.length)
		}
		cursor = complexEnd
	}
}

export function countMosaicTextGraphemes(text: string): number {
	let count = 0
	let cursor = 0
	while (cursor < text.length) {
		if (ascii(text.charCodeAt(cursor))) {
			let end = cursor + 1
			while (end < text.length && ascii(text.charCodeAt(end))) end++
			const retained =
				end < text.length &&
				end - cursor >= 2 &&
				text.charCodeAt(end - 2) === 0x0d &&
				text.charCodeAt(end - 1) === 0x0a
					? 2
					: 1
			const fastEnd =
				end === text.length ? end : Math.max(cursor, end - retained)
			count += fastEnd - cursor
			for (let index = cursor; index + 1 < fastEnd; index++) {
				if (
					text.charCodeAt(index) === 0x0d &&
					text.charCodeAt(index + 1) === 0x0a
				) {
					count--
					index++
				}
			}
			cursor = fastEnd
			if (cursor === text.length) break
		}

		const complexStart = cursor
		let complexEnd = text.length
		for (let index = cursor + 1; index < text.length; index++) {
			const previous = text.charCodeAt(index - 1)
			const current = text.charCodeAt(index)
			if (
				ascii(previous) &&
				ascii(current) &&
				!(previous === 0x0d && current === 0x0a)
			) {
				complexEnd = index
				break
			}
		}
		for (const _ of segmenter.segment(text.slice(complexStart, complexEnd))) {
			count++
		}
		cursor = complexEnd
	}
	return count
}
