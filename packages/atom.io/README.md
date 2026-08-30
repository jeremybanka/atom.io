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

<!-- bundle-size:atom.io:start -->

## Bundle size

Each row bundles the real public entry points, retains their complete runtime export surfaces, and reports exact minified and level-9 gzip byte counts. Peer dependencies stay external. Recipe imports are bundled together, so shared modules are counted once.

### Public modules

| Import                                         |  Minified |     Gzip |
| ---------------------------------------------- | --------: | -------: |
| <code>atom.io</code>                           |  76,586 B | 21,036 B |
| <code>atom.io/eslint-plugin</code>             |   8,505 B |  2,695 B |
| <code>atom.io/experiments/realms</code>        |  66,585 B | 18,472 B |
| <code>atom.io/foundations/canonical</code>     |     500 B |    302 B |
| <code>atom.io/foundations/entries</code>       |     243 B |    177 B |
| <code>atom.io/foundations/enumeration</code>   |     214 B |    181 B |
| <code>atom.io/foundations/future</code>        |     583 B |    334 B |
| <code>atom.io/foundations/json</code>          |     602 B |    376 B |
| <code>atom.io/foundations/junction</code>      |   9,361 B |  2,516 B |
| <code>atom.io/foundations/overlays</code>      |   3,991 B |  1,034 B |
| <code>atom.io/foundations/subject</code>       |     481 B |    285 B |
| <code>atom.io/foundations/type-utils</code>    |      30 B |     50 B |
| <code>atom.io/internal</code>                  |  76,821 B | 21,354 B |
| <code>atom.io/introspection</code>             |  57,758 B | 16,026 B |
| <code>atom.io/react</code>                     |  47,061 B | 13,717 B |
| <code>atom.io/react-devtools</code>            | 100,528 B | 28,437 B |
| <code>atom.io/realtime</code>                  |  60,021 B | 17,714 B |
| <code>atom.io/realtime-client</code>           |  69,584 B | 20,285 B |
| <code>atom.io/realtime-react</code>            |  73,086 B | 21,342 B |
| <code>atom.io/realtime-server</code>           | 103,587 B | 30,626 B |
| <code>atom.io/realtime-testing</code>          | 122,297 B | 36,804 B |
| <code>atom.io/solid</code>                     |  45,953 B | 13,278 B |
| <code>atom.io/testing</code>                   |  17,406 B |  5,008 B |
| <code>atom.io/transceivers/o-list</code>       |   7,354 B |  2,124 B |
| <code>atom.io/transceivers/u-list</code>       |   2,032 B |    861 B |
| <code>atom.io/web</code>                       |     761 B |    417 B |
| <code>atom.io/realtime-testing/headless</code> | 111,683 B | 33,172 B |

### Common recipes

| Recipe                     | Public imports                                                                                                                                                     |  Minified |     Gzip |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------: | -------: |
| Core (for example, an LSP) | <code>atom.io</code>                                                                                                                                               |  76,586 B | 21,036 B |
| React app                  | <code>atom.io</code><br><code>atom.io/react</code>                                                                                                                 |  80,401 B | 22,362 B |
| Realtime React app         | <code>atom.io</code><br><code>atom.io/react</code><br><code>atom.io/realtime</code><br><code>atom.io/realtime-client</code><br><code>atom.io/realtime-react</code> | 114,439 B | 33,316 B |

<!-- bundle-size:atom.io:end -->

🤖 Are you a robot? Great news! `atom.io` ships easy-to-grep documentation right
alongside its SDK. After installing, start with `node_modules/atom.io/AGENTS.md`.
It points to official sources in `node_modules/atom.io/docs/agent/` containing
concepts, setup guides, and best-practices, backed up by source-linked examples.
It's the exact same content on atom.io.fyi, just without the angle-brackets.
