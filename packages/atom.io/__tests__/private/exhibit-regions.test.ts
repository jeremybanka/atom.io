import { extractExhibitCode, parseExhibitReference } from "@atom.io/exhibits"

const MARKER_PAIRS = [
	{
		name: `hash`,
		start: `# @exhibit-region start my-region`,
		end: `# @exhibit-region end my-region`,
	},
	{
		name: `sql`,
		start: `-- @exhibit-region start my-region`,
		end: `-- @exhibit-region end my-region`,
	},
	{
		name: `slash`,
		start: `// @exhibit-region start my-region`,
		end: `// @exhibit-region end my-region`,
	},
	{
		name: `block`,
		start: `/* @exhibit-region start my-region */`,
		end: `/* @exhibit-region end my-region */`,
	},
] as const

describe(`exhibit regions`, () => {
	for (const { end, name, start } of MARKER_PAIRS) {
		test(`extracts a region from ${name} comments`, () => {
			const code = [`outer`, start, `  inner()`, end, `outer`].join(`\n`)

			expect(
				extractExhibitCode(code, parseExhibitReference(`demo.ts#my-region`)),
			).toBe(`inner()`)
		})
	}

	test(`returns the whole file when no region is requested`, () => {
		const code = `const value = 1`

		expect(extractExhibitCode(code, parseExhibitReference(`demo.ts`))).toBe(code)
	})

	test(`removes shared indentation from a region`, () => {
		const code = [
			`function render() {`,
			`\t// @exhibit-region start indented`,
			`\tconst value = 1`,
			`\tif (value) {`,
			`\t\treturn value`,
			`\t}`,
			`\t// @exhibit-region end indented`,
			`}`,
		].join(`\n`)

		expect(
			extractExhibitCode(code, parseExhibitReference(`demo.ts#indented`)),
		).toBe([`const value = 1`, `if (value) {`, `\treturn value`, `}`].join(`\n`))
	})

	test(`throws when a requested region does not exist`, () => {
		const code = [
			`// @exhibit-region start good`,
			`const value = 1`,
			`// @exhibit-region end good`,
		].join(`\n`)

		expect(() =>
			extractExhibitCode(code, parseExhibitReference(`demo.ts#missing`)),
		).toThrow(`Unknown exhibit region "missing" in demo.ts.`)
	})
})
