/** @jsxImportSource galley.md */
import { readFile } from "node:fs/promises"
import path from "node:path"

import { Comment, type Component, type Content, Html } from "galley.md"

type PackageManifest = {
	name: string
	dependencies?: Record<string, string>
}

export const GeneratedNotice: Component = () => (
	<Comment>Generated from README.mdx. Run pnpm readme:write to update.</Comment>
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
				<Html.Element tag="div" attributes={{ align: `center` }}>
					<Html.Element
						tag="img"
						attributes={{
							alt: `atom.io logo`,
							src: `https://raw.githubusercontent.com/jeremybanka/atom.io/main/apps/atom.io.fyi/public/favicon.png`,
							width: 160,
							height: 160,
						}}
					/>
				</Html.Element>
				<Html.Element tag="h1" attributes={{ align: `center` }}>
					<Html.Element tag="code">{manifest.name}</Html.Element>
				</Html.Element>
			</Html>
			{children}
			<Html>
				<Html.Element tag="p" attributes={{ align: `center` }}>
					<Html.Element
						tag="a"
						attributes={{ "aria-label": `NPM version`, href: npm }}
					>
						<Html.Element
							tag="img"
							attributes={{
								alt: `NPM Version`,
								src: `${shields}/npm/v/${manifest.name}?${badgeStyle}`,
							}}
						/>
					</Html.Element>
					<Html.Element
						tag="a"
						attributes={{
							"aria-label": `Dependencies ${dependencyCount}`,
							href: npm,
						}}
					>
						<Html.Element
							tag="img"
							attributes={{
								alt: `Dependencies ${dependencyCount}`,
								src: `${shields}/badge/dependencies-${dependencyCount}-0?${badgeStyle}`,
							}}
						/>
					</Html.Element>
					<Html.Element
						tag="a"
						attributes={{
							"aria-label": `Coverage`,
							href: `https://recoverage.cloud/`,
						}}
					>
						<Html.Element
							tag="img"
							attributes={{
								alt: `Coverage`,
								src: `${shields}/endpoint?url=${encodeURIComponent(coverage)}`,
							}}
						/>
					</Html.Element>
					<Html.Element
						tag="a"
						attributes={{ "aria-label": `Types`, href: npm }}
					>
						<Html.Element
							tag="img"
							attributes={{
								alt: `Types`,
								src: `${shields}/npm/types/${manifest.name}?${badgeStyle}`,
							}}
						/>
					</Html.Element>
				</Html.Element>
				<Html.Element tag="h3" attributes={{ align: `center` }}>
					{tagline}
				</Html.Element>
				<Html.Element tag="h3" attributes={{ align: `center` }}>
					<a href={`https://atom.io.fyi${docsPath ? `/docs/${docsPath}` : ``}`}>
						📖 Read the docs at atom.io.fyi
					</a>
				</Html.Element>
				{diskDocs ? (
					<Html.Element tag="h4" attributes={{ align: `center` }}>
						<Html.Element tag="i">
							Or read them right from your hard drive.
						</Html.Element>
					</Html.Element>
				) : null}
			</Html>
		</>
	)
}
