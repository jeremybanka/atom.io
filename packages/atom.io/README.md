<!-- Generated from README.mdx. Run pnpm tonnage to update. -->

<div align="center">
<img
	alt="atom.io logo"
	src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png"
	width="160"
	height="160"
>
</div>

<h1 align="center">
<code>atom.io</code>
</h1>

```shell
npm i atom.io

```

<p align="center">
<a aria-label="NPM version" href="https://www.npmjs.com/package/atom.io">
<img
		alt="NPM Version"
		src="https://img.shields.io/npm/v/atom.io?style=for-the-badge"
	>
</a>
<a aria-label="Dependencies 0" href="https://www.npmjs.com/package/atom.io">
<img
		alt="Dependencies 0"
		src="https://img.shields.io/badge/dependencies-0-0?style=for-the-badge"
	>
</a>
<a aria-label="Coverage" href="https://recoverage.cloud/">
<img
		alt="Coverage"
		src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F665Gbgm4N5b47w7qpruIa%2Fatom.io"
	>
</a>
<a aria-label="Types" href="https://www.npmjs.com/package/atom.io">
<img
		alt="Types"
		src="https://img.shields.io/npm/types/atom.io?style=for-the-badge"
	>
</a>

</p>

<h3 align="center">
Versatile state engine for TypeScript applications.
</h3>

<h3 align="center">
<a href="https://atom.io.fyi">📖 Read the docs at atom.io.fyi</a>
</h3>

<h4 align="center">
<i>Or read them right from your hard drive.</i>
</h4>

## Bundle size

Package export sizes include complete runtime export surfaces.

Usage example sizes bundle their entry files and tree-shake unused exports.

Sizes are exact minified and level-9 gzip JavaScript byte counts. Declarations, source maps, CSS, and other assets are excluded. Peer dependencies stay external, and shared modules are counted once per bundle.

### Package exports

| Import                              | Minified JS |  Gzip JS |
| ----------------------------------- | ----------: | -------: |
| `atom.io`                           |    75,958 B | 20,749 B |
| `atom.io/experiments/realms`        |    65,852 B | 18,204 B |
| `atom.io/foundations/canonical`     |       500 B |    302 B |
| `atom.io/foundations/entries`       |       243 B |    177 B |
| `atom.io/foundations/enumeration`   |       214 B |    183 B |
| `atom.io/foundations/future`        |       583 B |    332 B |
| `atom.io/foundations/json`          |       602 B |    377 B |
| `atom.io/foundations/junction`      |     9,349 B |  2,531 B |
| `atom.io/foundations/overlays`      |     3,991 B |  1,033 B |
| `atom.io/foundations/subject`       |       481 B |    284 B |
| `atom.io/foundations/type-utils`    |       604 B |    371 B |
| `atom.io/internal`                  |    76,189 B | 21,085 B |
| `atom.io/introspection`             |    57,202 B | 15,833 B |
| `atom.io/realtime`                  |    59,690 B | 17,508 B |
| `atom.io/realtime-client`           |    69,031 B | 19,978 B |
| `atom.io/realtime-react`            |    71,308 B | 20,700 B |
| `atom.io/realtime-server`           |   102,948 B | 30,215 B |
| `atom.io/realtime-testing/headless` |   119,897 B | 35,539 B |
| `atom.io/realtime-testing/react`    |    96,289 B | 28,308 B |
| `atom.io/testing`                   |    17,319 B |  4,956 B |
| `atom.io/transceivers/o-list`       |     7,225 B |  2,089 B |
| `atom.io/transceivers/u-list`       |     2,032 B |    869 B |
| `atom.io/web`                       |       757 B |    418 B |

### Usage examples

| Recipe                     | Entry                                      | Minified JS |  Gzip JS |
| -------------------------- | ------------------------------------------ | ----------: | -------: |
| Core (for example, an LSP) | `tonnage-recipes/core.ts`                  |    45,715 B | 12,909 B |
| React app                  | `tonnage-recipes/react-app.ts`             |    45,771 B | 12,955 B |
| Realtime React client      | `tonnage-recipes/realtime-react-client.ts` |    75,847 B | 22,169 B |
| Realtime server            | `tonnage-recipes/realtime-server.ts`       |    98,653 B | 27,878 B |

Report maintained with [tonnage](https://github.com/jeremybanka/tonnage).

🤖 Are you a robot? Great news! `atom.io` ships easy-to-grep documentation right
alongside its SDK. After installing, start with `node_modules/atom.io/AGENTS.md`.
It points to official sources in `node_modules/atom.io/docs/agent/` containing
concepts, setup guides, and best-practices, backed up by source-linked examples.
It's the exact same content on atom.io.fyi, just without the angle-brackets.
