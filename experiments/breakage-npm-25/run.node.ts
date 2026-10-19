import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

import { checkControls } from "./controls.ts"

const execute = promisify(execFile)
const revision = `44c750aaed47d6d1dfdaecfa801899283e495c70`
const root = fileURLToPath(new URL(`../../`, import.meta.url))
const experiment = join(root, `experiments/breakage-npm-25`)
const tool = join(root, `.breakage/npm25-tool`)
const toolRoot = resolve(process.argv[2] ?? join(homedir(), `breakage`))
const prepared = join(root, `.breakage/npm25-consumers`)
const quote = (value: string): string => `'${value.replaceAll(`'`, `'"'"'`)}'`
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
async function pack(directory: string, artifact = `package.tgz`): Promise<void> {
	await run(
		`pnpm`,
		[
			`--reporter=silent`,
			`pack`,
			`--out`,
			join(directory, `artifacts`, artifact),
		],
		directory,
	)
}

assert.equal(
	(
		await execute(`git`, [`cat-file`, `-t`, revision], { cwd: toolRoot })
	).stdout.trim(),
	`commit`,
)
// Archive the pinned, unmodified source; never depend on a mutable dist directory.
await rm(tool, { recursive: true, force: true })
await mkdir(tool, { recursive: true })
const archive = await execute(
	`git`,
	[`archive`, revision, `packages/breakage/src`],
	{ cwd: toolRoot, encoding: null, maxBuffer: 16 * 1024 * 1024 },
)
await writeFile(join(tool, `source.tar`), archive.stdout)
await run(`tar`, [`-xf`, `source.tar`, `--strip-components=2`], tool)
await json(join(tool, `package.json`), { type: `module` })
await symlink(
	join(toolRoot, `packages/breakage/node_modules`),
	join(tool, `node_modules`),
	`dir`,
)
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
await rm(prepared, { recursive: true, force: true })
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
	assert(versions.has(manifest.name), `Changesets must plan ${manifest.name}.`)
	for (const entry of [...manifest.files, `LICENSE`, `README.md`]) {
		try {
			await cp(join(source, entry), join(destination, entry), {
				recursive: true,
			})
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== `ENOENT`) throw error
		}
	}
	// Keep authored support and workspace versions intact. Breakage simulates only
	// certified peer metadata, recording the actual archive version separately.
	await json(join(destination, `package.json`), manifest)
	await mkdir(join(destination, `artifacts`), { recursive: true })
	if (name !== `atom.io`) {
		await cp(
			join(experiment, `contracts`, name),
			join(destination, `contracts`),
			{
				recursive: true,
			},
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
	// pnpm also resolves workspace dev dependencies when packing.
	for (const [dependency, specifier] of Object.entries(
		manifest.devDependencies,
	)) {
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
		await symlink(source, link, `dir`)
	}
	await pack(destination)
}

const reports = []
const audits = []
const controls = []
for (const name of [`react`, `solid`, `react-devtools`] as const) {
	const directory = join(prepared, name)
	const representatives = name === `solid` ? [`solid19`] : [`react18`, `react19`]
	for (const phase of [`released`, `coordinated`]) {
		for (const representative of representatives) {
			await cp(
				join(experiment, `environments`, phase, name, representative),
				join(directory, `peer-environments`, `${phase}-${representative}`),
				{ recursive: true },
			)
		}
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
		// Isolate current consumer compatibility from historical contract replay.
		baseline: { firstRelease: true },
		releaseIntent: ({ packageName }: { packageName: string }) => {
			const version = versions.get(packageName)
			return version ? { status: `release`, version } : { status: `none` }
		},
	}
	const report = await npmCheck(config, { baseDirectory: directory })
	reports.push(report)
	console.log(
		`${report.package.name}: ${report.exitCode} (${report.representatives.map((rep: { status: string }) => rep.status).join(`, `)})`,
	)
	await json(join(root, `.breakage/npm25-full-results.json`), { reports })
	assert.equal(report.exitCode, 0, JSON.stringify(report, null, 2))
	const audit = await npmCheck(config, {
		baseDirectory: directory,
		coverageOnly: true,
	})
	assert.equal(audit.exitCode, 0, JSON.stringify(audit, null, 2))
	audits.push({
		package: audit.package.name,
		exitCode: audit.exitCode,
		mode: audit.mode,
		coverage: audit.coverage,
	})
	controls.push(
		...(await checkControls({
			config,
			directory,
			representative: representatives[0]!,
			npmCheck,
			npmTest,
			pack,
		})),
	)
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
		package: report.package,
		exitCode: report.exitCode,
		support: report.support,
		errors: report.errors,
		representatives: report.representatives.map(
			(rep: {
				path: string
				status: string
				peers: Record<
					string,
					{ version: string; source: string; archiveVersion?: string }
				>
				suites: { peer: string; status: string }[]
				warnings: string[]
			}) => ({
				path: rep.path,
				status: rep.status,
				peers: Object.fromEntries(
					Object.entries(rep.peers).map(
						([name, { version, source, archiveVersion }]) => [
							name,
							{ version, source, archiveVersion },
						],
					),
				),
				suites: rep.suites.map(({ peer, status }) => ({ peer, status })),
				warnings: rep.warnings,
			}),
		),
		coverage: report.coverage,
	})),
	audits,
	controls,
})
