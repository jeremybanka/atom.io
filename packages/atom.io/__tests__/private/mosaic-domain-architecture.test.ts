import { readFileSync } from "node:fs"

const GENERIC_MOSAIC_DOMAIN_MODULES = [
	`../../src/realtime/mosaic-domain-history.ts`,
	`../../src/realtime-client/mosaic-domain-history-client.ts`,
	`../../src/realtime-client/mosaic-domain-history-socket.ts`,
	`../../src/realtime-server/mosaic-domain-history.ts`,
	`../../src/realtime-server/mosaic-domain-history-socket.ts`,
	`../../src/realtime-testing/mosaic-domain-conformance.ts`,
] as const

const MODEL_OR_RENDERER_IMPORT_SEGMENT =
	/(?:^|[-_.])(?:glyph|markdown|preact|react|renderer|solid|svg|templates?|text|vector)(?:$|[-_.])/i

const moduleSpecifiers = (source: string): readonly string[] =>
	[...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map(
		([, , specifier]) => specifier,
	)

describe(`Mosaic Domain architecture`, () => {
	test.each(GENERIC_MOSAIC_DOMAIN_MODULES)(
		`keeps model and renderer dependencies out of %s`,
		(modulePath) => {
			const source = readFileSync(new URL(modulePath, import.meta.url), `utf8`)
			const forbidden = moduleSpecifiers(source).filter((specifier) =>
				specifier
					.split(`/`)
					.some((segment) => MODEL_OR_RENDERER_IMPORT_SEGMENT.test(segment)),
			)

			expect(forbidden).toEqual([])
		},
	)
})
