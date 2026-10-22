<!-- Generated from README.mdx. Run pnpm readme:write to update. -->

<div align="center"><img alt="atom.io logo" src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png" width="160" height="160"></div><h1 align="center"><code>@atom.io/realtime</code></h1>

<p align="center"><a aria-label="NPM version" href="https://www.npmjs.com/package/@atom.io/realtime"><img alt="NPM Version" src="https://img.shields.io/npm/v/@atom.io/realtime?style=for-the-badge"></a><a aria-label="Dependencies 0" href="https://www.npmjs.com/package/@atom.io/realtime"><img alt="Dependencies 0" src="https://img.shields.io/badge/dependencies-0-0?style=for-the-badge"></a><a aria-label="Coverage" href="https://recoverage.cloud/"><img alt="Coverage" src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F665Gbgm4N5b47w7qpruIa%2Frealtime"></a><a aria-label="Types" href="https://www.npmjs.com/package/@atom.io/realtime"><img alt="Types" src="https://img.shields.io/npm/types/@atom.io/realtime?style=for-the-badge"></a></p><h3 align="center">Realtime collaboration for atom.io.</h3><h3 align="center"><a href="https://atom.io.fyi/docs/realtime">📖 Read the docs at atom.io.fyi</a></h3>

Install alongside `atom.io` 0.54 or later in the 0.54 release line. Framework, renderer, transport, and test-environment peers are optional and depend on the entry points you use.

| Entry point                          | Purpose                                         | Additional peers                                                                  |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `@atom.io/realtime`                  | Shared protocol, Mosaic models, and Domains     | None                                                                              |
| `@atom.io/realtime/client`           | Framework-neutral synchronization               | None                                                                              |
| `@atom.io/realtime/server`           | Node servers, storage, and process-backed rooms | Socket.IO for the Socket.IO server API                                            |
| `@atom.io/realtime/react`            | React lifecycle bindings                        | `@atom.io/react`, React 18 or 19; matching React types for TypeScript             |
| `@atom.io/realtime/react/lexical`    | Lexical editor adapter                          | React, ReactDOM, Lexical, `@lexical/react`, `@lexical/selection`                  |
| `@atom.io/realtime/testing/headless` | Renderer-free scenarios                         | Socket.IO and `socket.io-client`                                                  |
| `@atom.io/realtime/testing/react`    | Rendered scenarios                              | Headless peers plus `@atom.io/react`, React, ReactDOM, Testing Library, Happy DOM |

The guides and typechecked exhibits live in this package's `docs/source` directory. The React and client APIs consume the shared transport contract; a Cloudflare server adapter remains future work.

Migration: replace `atom.io/realtime` with `@atom.io/realtime`, and replace the old `realtime-client`, `realtime-server`, `realtime-react`, `realtime-react-lexical`, and `realtime-testing/*` subpaths with the corresponding entries above. The core SDK no longer exports realtime. No compatibility re-export introduces a dependency from `atom.io` back to this package.
