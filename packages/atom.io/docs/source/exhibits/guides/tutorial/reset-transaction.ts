const resetTX = transaction<() => Promise<void>>({
	key: `reset`,
	do: async ({ get, reset, set }) => {
		const logo = await get(preactLogoAtom)
		for (const pathKey of get(pathKeysAtom)) {
			reset(subpathKeysAtoms, pathKey)
		}
		reset(pathKeysAtom)

		// parse the SVG and rebuild all the related atoms
		set(pathKeysAtom, [`path0`, `path1`, `path2`])
	},
})

const reset = runTransaction(resetTX)
