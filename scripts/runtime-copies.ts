import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Window } from "happy-dom"

type Copy = `a` | `b` | `isolated/c` | `isolated/d`
type RuntimeCopies<Modules> = {
	isolatedDependencies: string
	load: <Entry extends keyof Modules>(
		copy: Copy,
		entry: Entry,
	) => Promise<Modules[Entry]>
}

export async function withRuntimeCopies<Modules extends object>(
	consumer: URL,
	adapters: string[],
	peers: string[],
	run: (copies: RuntimeCopies<Modules>) => Promise<void>,
): Promise<void> {
	const packageRoot = fileURLToPath(
		new URL(`../packages/atom.io/`, import.meta.url),
	)
	const consumerRoot = fileURLToPath(consumer)
	const require = createRequire(join(consumerRoot, `package.json`))
	const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-duplicate-runtime-`))
	const window = new Window()
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	})
	try {
		await symlink(
			join(consumerRoot, `node_modules`),
			join(fixtureRoot, `node_modules`),
			`dir`,
		)
		for (const name of [`a`, `b`, `isolated/c`, `isolated/d`]) {
			const destination = join(fixtureRoot, name)
			await cp(join(packageRoot, `dist`), join(destination, `dist`), {
				recursive: true,
			})
			await cp(
				join(packageRoot, `package.json`),
				join(destination, `package.json`),
			)
			await mkdir(join(destination, `node_modules/@atom.io`), {
				recursive: true,
			})
			await symlink(
				destination,
				join(destination, `node_modules/atom.io`),
				`dir`,
			)
			for (const adapter of adapters) {
				const adapterRoot = join(destination, `adapters`, adapter)
				await cp(
					join(packageRoot, `..`, adapter, `dist`),
					join(adapterRoot, `dist`),
					{ recursive: true },
				)
				await cp(
					join(packageRoot, `..`, adapter, `package.json`),
					join(adapterRoot, `package.json`),
				)
				await symlink(
					adapterRoot,
					join(destination, `node_modules/@atom.io`, adapter),
					`dir`,
				)
			}
		}
		const isolatedDependencies = join(fixtureRoot, `isolated/node_modules`)
		for (const peer of peers) {
			await cp(
				dirname(require.resolve(`${peer}/package.json`)),
				join(isolatedDependencies, peer),
				{ recursive: true },
			)
		}
		const load: RuntimeCopies<Modules>[`load`] = (copy, entry) =>
			import(
				pathToFileURL(
					adapters.includes(String(entry).split(`/`)[0]!)
						? join(
								fixtureRoot,
								copy,
								`adapters`,
								String(entry).split(`/`)[0]!,
								`dist`,
								...String(entry).split(`/`).slice(1),
								`index.js`,
							)
						: join(fixtureRoot, copy, `dist`, String(entry), `index.js`),
				).href
			)
		await run({ load, isolatedDependencies })
	} finally {
		await window.happyDOM.close()
		await rm(fixtureRoot, { recursive: true, force: true })
	}
}
