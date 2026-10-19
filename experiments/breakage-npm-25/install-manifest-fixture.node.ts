import { copyFile, link, mkdir } from "node:fs/promises"
import { join } from "node:path"

const fixture = process.env[`ATOM_IO_MANIFEST_FIXTURE`]
if (!fixture) throw new Error(`Missing manifest fixture.`)
const target = join(process.cwd(), `node_modules/@atom.io/react`)
const peer = join(process.cwd(), `node_modules/atom.io`)
await mkdir(target, { recursive: true })
await mkdir(peer, { recursive: true })
await copyFile(join(fixture, `target.json`), join(target, `package.json`))
await link(join(fixture, `cached-peer.json`), join(peer, `package.json`))
