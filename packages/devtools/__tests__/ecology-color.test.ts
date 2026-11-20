import * as THREE from "three"
import { expect, it } from "vitest"

import type { EcologyFamily, EcologyNode } from "../src/ecology.ts"
import { ecologyColor } from "../src/ecology-color.ts"

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

it(`digests singleton keys into stable, saturated warm/cool colors with contrast in both themes`, () => {
	const colors = new Set<string>()
	for (const key of [
		``,
		`pantry`,
		`🍊café`,
		...Array.from({ length: 1000 }, (_, i) => `node${i}`),
	]) {
		for (const selector of [false, true]) {
			const source = node(key, selector)
			const value = ecologyColor(source)
			expect(ecologyColor({ ...source })).toBe(value)
			colors.add(value)
			const color = new THREE.Color(value)
			const hsl = color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
			expect(hsl.s).toBeGreaterThanOrEqual(0.6)
			if (selector) {
				expect(hsl.h * 360).toBeGreaterThanOrEqual(90)
				expect(hsl.h * 360).toBeLessThan(270)
			} else expect(hsl.h * 360 < 90 || hsl.h * 360 >= 270).toBe(true)
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
	expect(colors.size).toBe(2006)
})

it(`gives every family member its family's color, including empty definitions and selector families`, () => {
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
})
