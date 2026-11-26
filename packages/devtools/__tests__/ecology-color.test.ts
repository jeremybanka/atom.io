import * as THREE from "three"
import { expect, it } from "vitest"

import type { EcologyFamily, EcologyNode } from "../src/ecology.ts"
import { ecologyColor } from "../src/ecology-color.ts"
import type { EcologySource } from "../src/ecology-graph.ts"

const node = (
	key: string,
	selector = false,
	family: string | null = null,
): EcologyNode => ({
	key,
	kind: selector ? `selector` : `atom`,
	type: selector ? `readonly_pure_selector` : `atom`,
	family: family === null ? null : { key: family, subKey: key },
	value: { status: `unknown` },
	dependencies: selector ? `unknown` : `not-applicable`,
	dependenciesTruncated: false,
})

it(`assigns stable, distinct hue ranges with contrast in both themes`, () => {
	const palettes: readonly [
		source: (key: string) => EcologySource,
		minimum: number,
		maximum: number,
	][] = [
		[(key) => node(key), 0, 50],
		[(key) => node(key, true), 182, 252],
		[(key) => ({ key, type: `transaction` }), 68, 169],
		[
			(key) => ({
				key,
				type: `timeline`,
				family: null,
				at: 0,
				historyLength: 0,
			}),
			265,
			315,
		],
	]
	const colors = new Set<string>()
	for (const key of [
		``,
		`pantry`,
		`🍊café`,
		...Array.from({ length: 1000 }, (_, i) => `node${i}`),
	]) {
		for (const [makeSource, minimum, maximum] of palettes) {
			const source = makeSource(key)
			const value = ecologyColor(source)
			expect(ecologyColor({ ...source })).toBe(value)
			colors.add(value)
			const color = new THREE.Color(value)
			const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
			expect(hsl.s).toBeGreaterThanOrEqual(0.6)
			expect(hsl.h * 360).toBeGreaterThanOrEqual(minimum)
			expect(hsl.h * 360).toBeLessThanOrEqual(maximum)
			const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
			expect(luminance).toBeCloseTo(0.18, 3)
			for (const background of [`#0a0a0a`, `#f6f6f6`]) {
				const rgb = new THREE.Color(background)
				const surface = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
				expect(
					(Math.max(surface, luminance) + 0.05) /
						(Math.min(surface, luminance) + 0.05),
				).toBeGreaterThan(4)
			}
		}
	}
	expect(colors.size).toBe(4012)
})

it(`gives atom, selector, and timeline family members their family's color`, () => {
	for (const selector of [false, true]) {
		const family: EcologyFamily = {
			key: `stockBySku`,
			type: selector ? `readonly_pure_selector_family` : `atom_family`,
			memberKeys: [],
			memberCount: 0,
			countComplete: true,
		}
		const color = ecologyColor(family)
		for (const key of [`stockBySku("rice")`, `stockBySku("beans")`])
			expect(ecologyColor(node(key, selector, family.key))).toBe(color)
		expect(
			ecologyColor({ ...family, memberKeys: [`later`], memberCount: 1 }),
		).toBe(color)
	}
	const history: EcologyFamily = {
		key: `history`,
		type: `timeline_family`,
		memberKeys: [],
		memberCount: 0,
		countComplete: true,
	}
	const color = ecologyColor(history)
	for (const subKey of [`"rice"`, `"beans"`])
		expect(
			ecologyColor({
				key: `${history.key}(${subKey})`,
				type: `timeline`,
				family: { key: history.key, subKey },
				at: 0,
				historyLength: 0,
			}),
		).toBe(color)
})
