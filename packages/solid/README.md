<!-- Generated from README.mdx. Run pnpm readme:write to update. -->

<div align="center"><img alt="atom.io logo" src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png" width="160" height="160"></div>

<h1 align="center"><code>@atom.io/solid</code></h1>

<p align="center"><a aria-label="NPM version" href="https://www.npmjs.com/package/@atom.io/solid"><img alt="NPM Version" src="https://img.shields.io/npm/v/@atom.io/solid?style=for-the-badge"></a><a aria-label="Dependencies 0" href="https://www.npmjs.com/package/@atom.io/solid"><img alt="Dependencies 0" src="https://img.shields.io/badge/dependencies-0-0?style=for-the-badge"></a><a aria-label="Coverage" href="https://recoverage.cloud/"><img alt="Coverage" src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F665Gbgm4N5b47w7qpruIa%2Fsolid"></a><a aria-label="Types" href="https://www.npmjs.com/package/@atom.io/solid"><img alt="Types" src="https://img.shields.io/npm/types/@atom.io/solid?style=for-the-badge"></a></p>

<h3 align="center">Solid bindings for atom.io.</h3>

<h3 align="center"><a href="https://atom.io.fyi/docs/solid">📖 Read the docs at atom.io.fyi</a></h3>

Install this package alongside `atom.io` and `solid-js` 1.9 or 2.0.0-rc.20. Replace imports from `atom.io/solid` with `@atom.io/solid`; the exports and behavior are unchanged.

## Install

```sh
pnpm add atom.io @atom.io/solid solid-js

```

## Usage

```tsx
/** @jsxImportSource solid-js */
import { useO } from "@atom.io/solid"
import { atom, setState } from "atom.io"
import type { JSX } from "solid-js"

const countAtom = atom<number>({ key: `count`, default: 0 })

export function Counter(): JSX.Element {
	const count = useO(countAtom)
	return (
		<button
			type="button"
			onClick={() => {
				setState(countAtom, (value) => value + 1)
			}}
		>
			Count: {count()}
		</button>
	)
}

```

## Bundle size

Package export sizes include complete runtime export surfaces.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Peer dependencies stay external, and shared modules are counted once per bundle.

| Import           | Minified JS | Gzip JS |
| ---------------- | ----------: | ------: |
| `@atom.io/solid` |     2,936 B | 1,332 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).
