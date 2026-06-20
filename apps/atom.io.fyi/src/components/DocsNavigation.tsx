import { atom } from "atom.io"
import { useI, useO } from "atom.io/react"
import type { VNode } from "preact"
import * as React from "react"

import css from "./DocsNavigation.module.css"
import { DynamicSpotlight } from "./DynamicSpotlight.tsx"
import { Toggle } from "./Toggle.tsx"

const INCLUDE_LIST = [`H2`, `H3`, `H4`, `H5`, `H6`]
const SECTION_VISIBILITY_EPSILON = 1

type HeadingDescriptor = { id: string; content: string | null; level: number }

const getHeadingLevel = (element: Element): number =>
	Number.parseInt(element.tagName.slice(1), 10)

const getHeadingElements = (): HTMLElement[] => {
	const allElements = document.querySelectorAll<HTMLElement>(`article [id]`)
	return Array.from(allElements).filter((element) =>
		INCLUDE_LIST.includes(element.tagName),
	)
}

const areListsEqual = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((value, index) => value === right[index])

const getScrollPaddingTop = (): number => {
	const scrollPaddingTop = Number.parseFloat(
		getComputedStyle(document.documentElement).scrollPaddingTop,
	)
	return Number.isFinite(scrollPaddingTop) ? scrollPaddingTop : 0
}

const getVisibleHeadingIds = (
	headingElements: readonly HTMLElement[],
): string[] => {
	const viewportTop = getScrollPaddingTop()
	const viewportBottom = window.innerHeight
	const articleBottom =
		document.querySelector(`article`)?.getBoundingClientRect().bottom ??
		document.documentElement.getBoundingClientRect().bottom

	return headingElements.flatMap((heading, index) => {
		const level = getHeadingLevel(heading)
		const top = heading.getBoundingClientRect().top
		let bottom = articleBottom

		for (
			let nextIndex = index + 1;
			nextIndex < headingElements.length;
			nextIndex++
		) {
			const nextHeading = headingElements[nextIndex]
			if (getHeadingLevel(nextHeading) <= level) {
				bottom = nextHeading.getBoundingClientRect().top
				break
			}
		}

		const visibleTop = Math.max(top, viewportTop)
		const visibleBottom = Math.min(bottom, viewportBottom)
		return visibleBottom - visibleTop > SECTION_VISIBILITY_EPSILON
			? [heading.id]
			: []
	})
}

const menuToggleAtom = atom<boolean>({
	key: `menuToggle`,
	default: false,
})

const pathnameAtom = atom<string>({
	key: `pathname`,
	default: globalThis.location?.pathname ?? ``,
	effects: [
		({ setSelf }) => {
			globalThis.document?.addEventListener(`astro:page-load`, () => {
				setSelf(window.location.pathname)
			})
		},
	],
})

export function DocsNavigation(): VNode {
	useO(pathnameAtom) // weirdly important
	const userHasToggled = useO(menuToggleAtom)
	const setUserHasToggled = useI(menuToggleAtom)

	return (
		<docs-navigation class={css.class}>
			<SiteDirectory />
			<OnThisPage />
			<Toggle.Button
				checked={userHasToggled}
				onChange={() => {
					setUserHasToggled((v) => !v)
				}}
			>
				☰
			</Toggle.Button>
		</docs-navigation>
	)
}

function OnThisPage(): VNode {
	const elementRef = React.useRef<HTMLElement>(null)
	const userHasToggled = useO(menuToggleAtom)

	const [headings, setHeadings] = React.useState<HeadingDescriptor[]>([])
	const [visibleHeadingIds, setVisibleHeadingIds] = React.useState<string[]>([])
	const pathname = useO(pathnameAtom)
	const visibleHeadingLinkIds = React.useMemo(
		() => visibleHeadingIds.map((id) => `${id}-link`),
		[visibleHeadingIds],
	)
	const visibleHeadingIdSet = React.useMemo(
		() => new Set(visibleHeadingIds),
		[visibleHeadingIds],
	)
	const rootHeadingLevel = React.useMemo(
		() =>
			headings.length === 0
				? 2
				: Math.min(...headings.map((heading) => heading.level)),
		[headings],
	)

	React.useEffect(() => {
		let animationFrame: number | null = null

		const setVisibleHeadings = (headingElements: readonly HTMLElement[]) => {
			const nextVisibleHeadingIds = getVisibleHeadingIds(headingElements)
			setVisibleHeadingIds((previous) =>
				areListsEqual(previous, nextVisibleHeadingIds)
					? previous
					: nextVisibleHeadingIds,
			)
		}

		const updateVisibleHeadings = () => {
			setVisibleHeadings(getHeadingElements())
		}

		const scheduleVisibleHeadingUpdate = () => {
			if (animationFrame !== null) {
				return
			}
			animationFrame = requestAnimationFrame(() => {
				animationFrame = null
				updateVisibleHeadings()
			})
		}

		const gatherHeadings = () => {
			const headingElements = getHeadingElements()
			const headingDescriptors = headingElements.map((element) => ({
				id: element.id,
				content: element.textContent,
				level: getHeadingLevel(element),
			}))
			setHeadings(headingDescriptors)
			setVisibleHeadings(headingElements)
		}

		gatherHeadings()

		addEventListener(`resize`, scheduleVisibleHeadingUpdate)
		addEventListener(`scroll`, scheduleVisibleHeadingUpdate, { passive: true })
		return () => {
			removeEventListener(`resize`, scheduleVisibleHeadingUpdate)
			removeEventListener(`scroll`, scheduleVisibleHeadingUpdate)
			if (animationFrame !== null) {
				cancelAnimationFrame(animationFrame)
			}
		}
	}, [pathname])

	const renderHeadings = (list: HeadingDescriptor[], level: number): VNode[] => {
		const output: VNode[] = []
		let currentIndex = 0

		while (currentIndex < list.length) {
			const heading = list[currentIndex]
			if (heading.level === level) {
				const subHeadings: HeadingDescriptor[] = []
				currentIndex++
				while (currentIndex < list.length && list[currentIndex].level > level) {
					subHeadings.push(list[currentIndex])
					currentIndex++
				}
				output.push(
					<section key={heading.id}>
						<a
							data-section-visible={visibleHeadingIdSet.has(heading.id)}
							href={`#${heading.id}`}
							id={`${heading.id}-link`}
						>
							{heading.content}
						</a>
						{subHeadings.length > 0 &&
							renderHeadings(
								subHeadings,
								Math.min(...subHeadings.map((subHeading) => subHeading.level)),
							)}
					</section>,
				)
			} else {
				currentIndex++
			}
		}

		return output
	}

	return (
		<on-this-page data-user-has-toggled={userHasToggled}>
			<nav id="on-this-page" ref={elementRef}>
				<DynamicSpotlight
					elementId="on-this-page"
					padding={0}
					updateSignals={[userHasToggled, pathname, headings]}
					parentRef={elementRef}
					variant="surface"
				/>
				<DynamicSpotlight
					elementIds={visibleHeadingLinkIds}
					updateSignals={[userHasToggled, pathname, headings]}
					parentRef={elementRef}
				/>
				<section>
					<header>On this page</header>
					<main>{renderHeadings(headings, rootHeadingLevel)}</main>
				</section>
			</nav>
		</on-this-page>
	)
}

function SiteDirectory(): VNode {
	const elementRef = React.useRef<HTMLElement>(null)
	const userHasToggled = useO(menuToggleAtom)
	const pathname = useO(pathnameAtom)
	const pathnameId =
		(pathname.endsWith(`/`) ? pathname.slice(0, -1) : pathname).replaceAll(
			`/`,
			`-`,
		) + `-link`
	return (
		<site-directory data-user-has-toggled={userHasToggled}>
			<nav id="site-directory" ref={elementRef}>
				<DynamicSpotlight
					elementId="site-directory"
					padding={0}
					updateSignals={[userHasToggled, pathname]}
					parentRef={elementRef}
					variant="surface"
				/>
				<DynamicSpotlight
					elementId={pathnameId}
					updateSignals={[userHasToggled, pathname]}
					parentRef={elementRef}
				/>
				<section>
					<header>Guide</header>
					<main>
						<section>
							<a id="-docs-link" href="/docs">
								understand atom.io
							</a>
						</section>
						<section>
							<a id="-docs-getting-started-link" href="/docs/getting-started">
								getting started
							</a>
						</section>
						<section>
							<a id="-docs-tutorial-link" href="/docs/tutorial">
								tutorial
							</a>
						</section>
						<section>
							<a
								id="-docs-atom-io-vs-others-link"
								href="/docs/atom-io-vs-others"
							>
								atom.io vs others
							</a>
						</section>
						<section>
							<a id="-docs-concepts-link" href="/docs/concepts">
								concepts
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Integrations</header>
					<main>
						<section>
							<a id="-docs-remote-data-link" href="/docs/remote-data">
								remote data
							</a>
						</section>
						<section>
							<a id="-docs-typesafe-router-link" href="/docs/typesafe-router">
								typesafe router
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Interface</header>
					<main>
						<section>
							<a id="-docs-atom-io-link" href={`/docs/atom-io`}>
								atom.io
							</a>
						</section>
						<section>
							<a id="-docs-react-link" href={`/docs/react`}>
								<low-emphasis>atom.io</low-emphasis>/react
							</a>
						</section>
						<section>
							<a id="-docs-web-link" href={`/docs/web`}>
								<low-emphasis>atom.io</low-emphasis>/web
							</a>
						</section>
						<section>
							<a id="-docs-transceivers-link" href={`/docs/transceivers`}>
								<low-emphasis>atom.io</low-emphasis>/transceivers
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Tooling</header>
					<main>
						<section>
							<a id="-docs-eslint-plugin-link" href={`/docs/eslint-plugin`}>
								<low-emphasis>atom.io</low-emphasis>/eslint-plugin
							</a>
						</section>
						<section>
							<a id="-docs-react-devtools-link" href={`/docs/react-devtools`}>
								<low-emphasis>atom.io</low-emphasis>/react-devtools
							</a>
						</section>
						<section>
							<a id="-docs-testing-link" href={`/docs/testing`}>
								<low-emphasis>atom.io</low-emphasis>/testing
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Foundations</header>
					<main>
						<section>
							<a id="-docs-foundations-link" href={`/docs/foundations`}>
								<low-emphasis>atom.io</low-emphasis>/foundations
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-json-link"
								href={`/docs/foundations/json`}
							>
								<low-emphasis>foundations</low-emphasis>/json
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-canonical-link"
								href={`/docs/foundations/canonical`}
							>
								<low-emphasis>foundations</low-emphasis>/canonical
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-entries-link"
								href={`/docs/foundations/entries`}
							>
								<low-emphasis>foundations</low-emphasis>/entries
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-enumeration-link"
								href={`/docs/foundations/enumeration`}
							>
								<low-emphasis>foundations</low-emphasis>/enumeration
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-type-utils-link"
								href={`/docs/foundations/type-utils`}
							>
								<low-emphasis>foundations</low-emphasis>/type-utils
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-future-link"
								href={`/docs/foundations/future`}
							>
								<low-emphasis>foundations</low-emphasis>/future
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-subject-link"
								href={`/docs/foundations/subject`}
							>
								<low-emphasis>foundations</low-emphasis>/subject
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-overlays-link"
								href={`/docs/foundations/overlays`}
							>
								<low-emphasis>foundations</low-emphasis>/overlays
							</a>
						</section>
						<section>
							<a
								id="-docs-foundations-junction-link"
								href={`/docs/foundations/junction`}
							>
								<low-emphasis>foundations</low-emphasis>/junction
							</a>
						</section>
					</main>
				</section>
			</nav>
		</site-directory>
	)
}
