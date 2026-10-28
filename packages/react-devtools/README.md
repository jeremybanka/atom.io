<!-- Generated from README.mdx. Run pnpm readme:write to update. -->

<div align="center"><img alt="atom.io logo" src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png" width="160" height="160"></div>

<h1 align="center"><code>@atom.io/react-devtools</code></h1>

<p align="center"><a aria-label="NPM version" href="https://www.npmjs.com/package/@atom.io/react-devtools"><img alt="NPM Version" src="https://img.shields.io/npm/v/@atom.io/react-devtools?style=for-the-badge"></a><a aria-label="Dependencies 1" href="https://www.npmjs.com/package/@atom.io/react-devtools"><img alt="Dependencies 1" src="https://img.shields.io/badge/dependencies-1-0?style=for-the-badge"></a><a aria-label="Coverage" href="https://recoverage.cloud/"><img alt="Coverage" src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F665Gbgm4N5b47w7qpruIa%2Freact-devtools"></a><a aria-label="Types" href="https://www.npmjs.com/package/@atom.io/react-devtools"><img alt="Types" src="https://img.shields.io/npm/types/@atom.io/react-devtools?style=for-the-badge"></a></p>

<h3 align="center">React developer tools for atom.io stores.</h3>

<h3 align="center"><a href="https://atom.io.fyi/docs/react-devtools">📖 Read the docs at atom.io.fyi</a></h3>

Install this package alongside `atom.io`, `@atom.io/react`, and React/React DOM 18 or 19. Motion is included as a regular dependency. Import the stylesheet from `@atom.io/react-devtools/css`. Replace imports from `atom.io/react-devtools` with `@atom.io/react-devtools`; the exports and behavior are unchanged.

## Install

```sh
pnpm add atom.io @atom.io/react @atom.io/react-devtools react react-dom

```

## Setup

```tsx
import "@atom.io/react-devtools/css"

import { AtomIODevtools } from "@atom.io/react-devtools"
import type { JSX } from "react"

export function App(): JSX.Element {
	return (
		<>
			<main>{/* your app */}</main>
			<AtomIODevtools />
		</>
	)
}

```

## Bundle size

Package export sizes include complete runtime export surfaces.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Peer dependencies stay external, and shared modules are counted once per bundle.

| Import                    | Minified JS |  Gzip JS |
| ------------------------- | ----------: | -------: |
| `@atom.io/react-devtools` |   163,150 B | 53,972 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

The report measures JavaScript only; the required stylesheet is excluded.
