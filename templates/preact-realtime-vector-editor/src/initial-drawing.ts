import type { SvgDrawingFixture } from "./design-model.ts"

/** A deliberately small path fixture: enough structure to teach the model. */
export const INITIAL_DRAWING: SvgDrawingFixture = {
	paths: [
		{
			id: `plane-mark`,
			subpaths: [
				{ edge: { kind: `move` }, id: `mark-0`, node: { x: 72, y: 64 } },
				{
					edge: { c: { x: 136, y: 28 }, kind: `cubic`, s: { x: 188, y: 72 } },
					id: `mark-1`,
					node: { x: 184, y: 132 },
				},
				{ edge: { kind: `line` }, id: `mark-2`, node: { x: 116, y: 184 } },
				{ edge: { kind: `line` }, id: `mark-3`, node: { x: 54, y: 126 } },
				{ edge: { kind: `close` }, id: `mark-close`, node: null },
			],
		},
	],
}
