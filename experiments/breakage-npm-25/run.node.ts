import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const revision = `0d9b7e5b7f4768629ecbb6b41c670952ffdc85e2`
const root = fileURLToPath(new URL(`../../`, import.meta.url))
const experiment = join(root, `experiments/breakage-npm-25`)
const tool = join(root, `.breakage/npm25-tool`)
const toolRoot = resolve(process.argv[2] ?? `/tmp/breakage-npm`)
const store =
	process.env[`ATOM_IO_PEER_STORE`] ?? `/tmp/atomio-npm25-offline-store`
process.env[`ATOM_IO_PEER_STORE`] = store
process.env[`XDG_CACHE_HOME`] = `/tmp/atomio-breakage-npm-cache`
process.env[`XDG_STATE_HOME`] = `/tmp/atomio-breakage-npm-state`
process.env[`XDG_DATA_HOME`] = `/tmp/atomio-breakage-npm-data`
process.env[`XDG_RUNTIME_DIR`] = `/tmp/atomio-breakage-npm-runtime`
const quote = (value: string): string => `'${value.replaceAll(`'`, `'\''`)}'`
async function run(command: string, args: string[], cwd: string): Promise<void> {
	try {
		await execute(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 })
	} catch (error) {
		process.stderr.write(String((error as { stdout?: string }).stdout ?? ``))
		process.stderr.write(String((error as { stderr?: string }).stderr ?? ``))
		throw error
	}
}
async function json(filename: string, value: unknown): Promise<void> {
	await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`)
}

assert.equal(
	(
		await execute(`git`, [`cat-file`, `-t`, revision], { cwd: toolRoot })
	).stdout.trim(),
	`commit`,
)
await mkdir(tool, { recursive: true })
await rm(join(tool, `src`), { recursive: true, force: true })
const archive = await execute(
	`git`,
	[`archive`, revision, `packages/breakage/src`],
	{ cwd: toolRoot, encoding: null, maxBuffer: 16 * 1024 * 1024 },
)
await writeFile(join(tool, `source.tar`), archive.stdout)
await run(`tar`, [`-xf`, `source.tar`, `--strip-components=2`], tool)
await json(join(tool, `package.json`), { type: `module` })
await rm(join(tool, `node_modules`), { recursive: true, force: true })
await symlink(
	join(toolRoot, `packages/breakage/node_modules`),
	join(tool, `node_modules`),
	`dir`,
)
await run(
	`patch`,
	[`--batch`, `-p1`, `-i`, join(experiment, `workspace-peers.patch`)],
	tool,
)
await run(process.execPath, [join(experiment, `workspace.test.ts`)], root)
const { npmCheck, npmTest } = await import(
	pathToFileURL(join(tool, `src/breakage.ts`)).href
)

await run(
	join(root, `node_modules/.bin/changeset`),
	[`status`, `--output`, join(root, `.breakage/npm25-release-plan.json`)],
	root,
)
const plan = JSON.parse(
	await readFile(join(root, `.breakage/npm25-release-plan.json`), `utf8`),
)
const versions = new Map<string, string>(
	plan.releases.map((release: { name: string; newVersion: string }) => [
		release.name,
		release.newVersion,
	]),
)
const names = [`atom.io`, `react`, `solid`, `react-devtools`] as const
const reports = []
const controls = []
for (const phase of [`released`, `coordinated`] as const) {
	const coordinated = phase === `coordinated`
	const prepared = join(root, `.breakage/npm25-${phase}`)
	await mkdir(prepared, { recursive: true })
	await json(join(prepared, `package.json`), { private: true, type: `module` })
	await writeFile(
		join(prepared, `pnpm-workspace.yaml`),
		`packages: [atom.io, react, solid, react-devtools]\nautoInstallPeers: false\n`,
	)
	for (const name of names) {
		const source = join(root, `packages`, name)
		const destination = join(prepared, name)
		await mkdir(destination, { recursive: true })
		const manifest = JSON.parse(
			await readFile(join(source, `package.json`), `utf8`),
		)
		for (const entry of [
			...manifest.files,
			`LICENSE`,
			`README.md`,
			...(name === `react-devtools` ? [`css.d.ts`] : []),
		]) {
			try {
				await cp(join(source, entry), join(destination, entry), {
					recursive: true,
				})
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== `ENOENT`) throw error
			}
		}
		const version = coordinated ? versions.get(manifest.name) : manifest.version
		assert(version, `Changesets must certify a release for ${manifest.name}.`)
		await json(join(destination, `package.json`), { ...manifest, version })
		await mkdir(join(destination, `artifacts`), { recursive: true })
		if (name !== `atom.io`) {
			await cp(
				join(experiment, `contracts`, name),
				join(destination, `contracts`),
				{ recursive: true },
			)
			await cp(
				join(experiment, `contracts/tsconfig.json`),
				join(destination, `contracts/tsconfig.json`),
			)
		}
	}

	for (const name of names) {
		const destination = join(prepared, name)
		const manifest = JSON.parse(
			await readFile(join(destination, `package.json`), `utf8`),
		)
		for (const [dependency, specifier] of Object.entries({
			...manifest.devDependencies,
			...manifest.peerDependencies,
		})) {
			if (!String(specifier).startsWith(`workspace:`)) continue
			const preparedPeer = names.find(
				(candidate) =>
					(candidate === `atom.io` ? candidate : `@atom.io/${candidate}`) ===
					dependency,
			)
			const source = preparedPeer
				? join(prepared, preparedPeer)
				: join(root, `packages`, name, `node_modules`, dependency)
			const link = join(destination, `node_modules`, dependency)
			await mkdir(resolve(link, `..`), { recursive: true })
			await rm(link, { force: true })
			await symlink(source, link, `dir`)
		}
		await run(
			`pnpm`,
			[
				`--reporter=silent`,
				`pack`,
				`--out`,
				join(destination, `artifacts/package.tgz`),
			],
			destination,
		)
	}

	const targets = coordinated
		? ([`react`, `solid`, `react-devtools`] as const)
		: ([`react`, `solid`] as const)
	for (const name of targets) {
		const directory = join(prepared, name)
		const representatives =
			name === `solid` ? [`solid19`] : [`react18`, `react19`]
		for (const representative of representatives) {
			const destination = join(directory, `peer-environments`, representative)
			await mkdir(destination, { recursive: true })
			await cp(
				join(experiment, `environments`, phase, name, representative),
				destination,
				{ recursive: true },
			)
			await run(
				process.execPath,
				[join(experiment, `install.node.ts`), `prepare`],
				destination,
			)
		}
		const runtime = `node ${name === `solid` ? `--conditions=browser ` : ``}contracts/runtime.test.ts`
		const types = `node ../node_modules/typescript/bin/tsc --project contracts/tsconfig.json`
		const suite = { files: [`contracts/*`], command: `${runtime} && ${types}` }
		const peers =
			name === `solid`
				? [`atom.io`, `solid-js`]
				: name === `react`
					? [`atom.io`, `react`]
					: [`atom.io`, `@atom.io/react`, `react`, `react-dom`]
		const config = {
			artifact: `artifacts/package.tgz`,
			representatives: `peer-environments/*`,
			lockfile: `pnpm-lock.yaml`,
			prepareCommand: `node ${quote(join(experiment, `install.node.ts`))} prepare`,
			installCommand: `node ${quote(join(experiment, `install.node.ts`))} stage`,
			suites: Object.fromEntries(peers.map((peer) => [peer, suite])),
			localPeers: {
				"atom.io": {
					directory: `../atom.io`,
					artifact: `../atom.io/artifacts/package.tgz`,
				},
				...(name === `react-devtools`
					? {
							"@atom.io/react": {
								directory: `../react`,
								artifact: `../react/artifacts/package.tgz`,
							},
						}
					: {}),
			},
			// This experiment exercises peer compatibility, not a historical support gate.
			baseline: { firstRelease: true },
			releaseIntent: ({ packageName }: { packageName: string }) => {
				const version = versions.get(packageName)
				return version ? { status: `release`, version } : { status: `none` }
			},
		}
		await json(join(directory, `npm-config.json`), config)
		const report = await npmCheck(config, { baseDirectory: directory })
		reports.push({ phase, ...report })
		console.log(
			`${phase} ${report.package.name}: ${report.exitCode} (${report.representatives.map((rep: { status: string }) => rep.status).join(`, `)})`,
		)
		await json(join(root, `.breakage/npm25-full-results.json`), {
			breakageRevision: revision,
			reports,
		})
		if (report.exitCode !== 0) console.log(JSON.stringify(report, null, 2))
		if (coordinated) {
			const missingIntent = await npmTest(
				{ ...config, releaseIntent: () => ({ status: `none` }) },
				{ representative: `peer-environments/${representatives[0]}` },
				{ baseDirectory: directory },
			)
			assert.equal(
				missingIntent.exitCode,
				2,
				`Missing candidate release evidence must fail setup.`,
			)
			controls.push({
				package: report.package.name,
				missingReleaseIntent: `rejected`,
			})
			if (name === `react` && report.exitCode === 0) {
				const filename = join(directory, `dist/index.js`)
				const original = await readFile(filename, `utf8`)
				const mutated = original.replace(
					`function useO(...params) {`,
					`function useO(...params) { return 0;`,
				)
				assert.notEqual(
					mutated,
					original,
					`The probe must modify the packed hook implementation.`,
				)
				try {
					await writeFile(filename, mutated)
					await run(
						`pnpm`,
						[
							`--reporter=silent`,
							`pack`,
							`--out`,
							join(directory, `artifacts/mutated.tgz`),
						],
						directory,
					)
				} finally {
					await writeFile(filename, original)
				}
				const mutation = await npmTest(
					{ ...config, artifact: `artifacts/mutated.tgz` },
					{ representative: `peer-environments/${representatives[0]}` },
					{ baseDirectory: directory },
				)
				assert.equal(
					mutation.exitCode,
					1,
					`A broken packed hook must fail compatibility.`,
				)
				controls.push({
					package: report.package.name,
					brokenPackedHook: `rejected`,
				})
			}
		}
	}
}
await json(join(experiment, `consumer-results.json`), {
	breakageRevision: revision,
	versions: Object.fromEntries(
		[...versions].filter(([name]) =>
			[
				`atom.io`,
				`@atom.io/react`,
				`@atom.io/solid`,
				`@atom.io/react-devtools`,
			].includes(name),
		),
	),
	reports: reports.map((report) => ({
		phase: report.phase,
		package: report.package,
		exitCode: report.exitCode,
		representatives: report.representatives.map(
			(rep: {
				path: string
				status: string
				peers: Record<string, { version: string; source: string }>
				suites: { peer: string; status: string }[]
			}) => ({
				path: rep.path,
				status: rep.status,
				peers: Object.fromEntries(
					Object.entries(rep.peers).map(([name, peer]) => [
						name,
						{ version: peer.version, source: peer.source },
					]),
				),
				suites: rep.suites.map(({ peer, status }) => ({ peer, status })),
			}),
		),
		coverage: report.coverage,
	})),
	controls,
})
process.exitCode = Math.max(...reports.map((report) => report.exitCode))
