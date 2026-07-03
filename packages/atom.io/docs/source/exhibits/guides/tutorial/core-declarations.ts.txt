type PointXY = { x: number; y: number }
type EdgeXY = { c?: PointXY; s: PointXY }

const pathKeysAtom = atom<string[]>({
	key: `pathKeys`,
	default: [],
})
const subpathKeysAtoms = atomFamily<string[], string>({
	key: `subpathKeys`,
	default: [],
})
const nodeAtoms = atomFamily<PointXY | null, string>({
	key: `node`,
	default: null,
})
const edgeAtoms = atomFamily<EdgeXY | boolean, string>({
	key: `edge`,
	default: true,
})
const pathDrawSelectors = selectorFamily<string, string>({
	key: `pathDraw`,
	get:
		(pathKey) =>
		({ get }) => {
			const subpathKeys = get(subpathKeysAtoms, pathKey)
			return subpathKeys
				.map((subpathKey, idx) => {
					// ...
				})
				.join(` `)
		},
})
