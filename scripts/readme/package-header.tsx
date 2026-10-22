/** @jsxImportSource galley.md */
import { readFile } from "node:fs/promises"
import path from "node:path"

import { type Component, type Content, Html, Markdown } from "galley.md"

type PackageManifest = {
	name: string
	dependencies?: Record<string, string>
}

export const GeneratedNotice: Component = () => (
	<Markdown children="<!-- Generated from README.mdx. Run pnpm readme:write to update. -->" />
)

export const PackageHeader: Component<{
	tagline: string
	docsPath?: string
	coverageSlug: string
	diskDocs?: boolean
	children?: Content
}> = async (
	{ tagline, docsPath, coverageSlug, diskDocs, children },
	context,
) => {
	const manifest = JSON.parse(
		await readFile(path.join(context.directory, `package.json`), `utf8`),
	) as PackageManifest
	const dependencyCount = Object.keys(manifest.dependencies ?? {}).length
	const npm = `https://www.npmjs.com/package/${manifest.name}`
	const shields = `https://img.shields.io`
	const badgeStyle = `style=for-the-badge`
	const coverage = `https://recoverage.cloud/shields/665Gbgm4N5b47w7qpruIa/${coverageSlug}`
	return (
		<>
			<GeneratedNotice />
			<Html>
				<div align="center">
					<img
						alt="atom.io logo"
						src="https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png"
						width={160}
						height={160}
					/>
				</div>
				<h1 align="center">
					<code>{manifest.name}</code>
				</h1>
			</Html>
			{children}
			<Html>
				<p align="center">
					<a aria-label="NPM version" href={npm}>
						<img
							alt="NPM Version"
							src={`${shields}/npm/v/${manifest.name}?${badgeStyle}`}
						/>
					</a>
					<a aria-label={`Dependencies ${dependencyCount}`} href={npm}>
						<img
							alt={`Dependencies ${dependencyCount}`}
							src={`${shields}/badge/dependencies-${dependencyCount}-0?${badgeStyle}`}
						/>
					</a>
					<a aria-label="Coverage" href="https://recoverage.cloud/">
						<img
							alt="Coverage"
							src={`${shields}/endpoint?url=${encodeURIComponent(coverage)}`}
						/>
					</a>
					<a aria-label="Types" href={npm}>
						<img
							alt="Types"
							src={`${shields}/npm/types/${manifest.name}?${badgeStyle}`}
						/>
					</a>
				</p>
				<h3 align="center">{tagline}</h3>
				<h3 align="center">
					<a href={`https://atom.io.fyi${docsPath ? `/docs/${docsPath}` : ``}`}>
						📖 Read the docs at atom.io.fyi
					</a>
				</h3>
				{diskDocs ? (
					<h4 align="center">
						<i>Or read them right from your hard drive.</i>
					</h4>
				) : null}
			</Html>
		</>
	)
}
