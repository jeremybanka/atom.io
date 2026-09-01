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
			src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2FS1ikz1yFmk93qbAI7lLnu%2Fatom.io"
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

<!-- tonnage:atom.io:start -->

## Bundle size

Public-module rows retain complete runtime export surfaces. Recipe rows bundle their reviewable entry files and tree-shake unused exports. Both report exact minified and level-9 gzip JavaScript byte counts; declarations, source maps, CSS, and other assets are excluded. Peer dependencies stay external, and shared modules are counted once per bundle.

### Public modules (whole export surface)

| Import                                         | Minified JS |  Gzip JS |
| ---------------------------------------------- | ----------: | -------: |
| <code>atom.io</code>                           |    80,268 B | 22,164 B |
| <code>atom.io/eslint-plugin</code>             |     8,505 B |  2,695 B |
| <code>atom.io/experiments/realms</code>        |    70,239 B | 19,601 B |
| <code>atom.io/foundations/canonical</code>     |       500 B |    302 B |
| <code>atom.io/foundations/entries</code>       |       243 B |    177 B |
| <code>atom.io/foundations/enumeration</code>   |       214 B |    181 B |
| <code>atom.io/foundations/future</code>        |       583 B |    334 B |
| <code>atom.io/foundations/json</code>          |       602 B |    376 B |
| <code>atom.io/foundations/junction</code>      |     9,361 B |  2,516 B |
| <code>atom.io/foundations/overlays</code>      |     3,991 B |  1,034 B |
| <code>atom.io/foundations/subject</code>       |       481 B |    285 B |
| <code>atom.io/foundations/type-utils</code>    |        30 B |     50 B |
| <code>atom.io/internal</code>                  |    80,835 B | 22,592 B |
| <code>atom.io/introspection</code>             |    58,479 B | 16,234 B |
| <code>atom.io/react</code>                     |    48,011 B | 13,990 B |
| <code>atom.io/react-devtools</code>            |    96,984 B | 27,626 B |
| <code>atom.io/realtime</code>                  |   153,210 B | 44,030 B |
| <code>atom.io/realtime-client</code>           |   157,481 B | 44,649 B |
| <code>atom.io/realtime-react</code>            |    85,381 B | 25,497 B |
| <code>atom.io/realtime-react-lexical</code>    |    10,296 B |  4,074 B |
| <code>atom.io/realtime-server</code>           |   238,880 B | 66,622 B |
| <code>atom.io/realtime-testing</code>          |   150,492 B | 45,084 B |
| <code>atom.io/solid</code>                     |    46,903 B | 13,554 B |
| <code>atom.io/testing</code>                   |    17,430 B |  5,014 B |
| <code>atom.io/transceivers/o-list</code>       |     7,354 B |  2,124 B |
| <code>atom.io/transceivers/u-list</code>       |     2,032 B |    861 B |
| <code>atom.io/web</code>                       |       761 B |    417 B |
| <code>atom.io/realtime-testing/headless</code> |   115,366 B | 34,306 B |

### Representative runtimes (tree-shaken)

| Recipe                     | Entry                                                 | Minified JS |  Gzip JS |
| -------------------------- | ----------------------------------------------------- | ----------: | -------: |
| Core (for example, an LSP) | <code>tonnage-recipes/core.ts</code>                  |    46,727 B | 13,305 B |
| React app                  | <code>tonnage-recipes/react-app.ts</code>             |    48,704 B | 13,935 B |
| Realtime React client      | <code>tonnage-recipes/realtime-react-client.ts</code> |    94,614 B | 27,630 B |
| Realtime server            | <code>tonnage-recipes/realtime-server.ts</code>       |   102,266 B | 28,976 B |

<!-- tonnage:atom.io:end -->

🤖 Are you a robot? Great news! `atom.io` ships easy-to-grep documentation right
alongside its SDK. After installing, start with `node_modules/atom.io/AGENTS.md`.
It points to official sources in `node_modules/atom.io/docs/agent/` containing
concepts, setup guides, and best-practices, backed up by source-linked examples.
It's the exact same content on atom.io.fyi, just without the angle-brackets.
