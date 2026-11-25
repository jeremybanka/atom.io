import type { EcologySource } from "./ecology-graph.ts"

/** A key digest owns a hue; members inherit their family's identity. */
export function ecologyColor(source: EcologySource): string {
	const key =
		`family` in source && source.family ? source.family.key : source.key
	let digest = 0x811c9dc5
	for (let index = 0; index < key.length; index++)
		digest = Math.imul(digest ^ key.charCodeAt(index), 0x01000193) >>> 0
	const start = source.type.includes(`selector`)
		? 90
		: source.type === `transaction`
			? 0
			: source.type.startsWith(`timeline`)
				? 180
				: 270
	const hue = (start + (digest / 0x1_0000_0000) * 180) % 360
	// Constant saturation, balanced luminance: yellow and blue need different HSL lightness
	// to remain visible against both debugger themes. Keep Three.js out of the metadata path.
	let low = 0,
		high = 1
	for (let step = 0; step < 12; step++) {
		const lightness = (low + high) / 2
		const amplitude = 0.75 * Math.min(lightness, 1 - lightness)
		const channel = (offset: number) => {
			const k = (offset + hue / 30) % 12
			const value =
				lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))
			// At this saturation and luminance, channels remain above sRGB's linear toe.
			return ((value + 0.055) / 1.055) ** 2.4
		}
		const luminance =
			0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4)
		if (luminance < 0.18) low = lightness
		else high = lightness
	}
	return `hsl(${hue.toFixed(8)}, 75%, ${(((low + high) / 2) * 100).toFixed(4)}%)`
}
