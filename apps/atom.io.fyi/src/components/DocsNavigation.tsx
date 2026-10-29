import type { VNode } from "hydrogen"
import { onCleanup, onMount, useSetter, useValue } from "hydrogen"

import {
	type HeadingDescriptor,
	headingsAtom,
	menuToggleAtom,
	pathnameAtom,
	visibleHeadingIdsAtom,
} from "../navigation-state.ts"
import { createSiteStore } from "../site-store.ts"
import css from "./DocsNavigation.module.css"
import { DynamicSpotlight } from "./DynamicSpotlight.tsx"
import { Toggle } from "./Toggle.tsx"

const INCLUDE_LIST = [`H2`, `H3`, `H4`, `H5`, `H6`]
const SECTION_VISIBILITY_EPSILON = 1

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

export function DocsNavigation(_props: { pathname: string }): VNode {
	const setPathname = useSetter(pathnameAtom)
	const pathname = useValue(pathnameAtom)
	onMount(() => {
		const update = () => {
			setPathname(window.location.pathname)
		}
		document.addEventListener(`astro:page-load`, update)
		onCleanup(() => {
			document.removeEventListener(`astro:page-load`, update)
		})
		update()
	})
	const userHasToggled = useValue(menuToggleAtom)
	const setUserHasToggled = useSetter(menuToggleAtom)

	return (
		<docs-navigation class={css.class} data-pathname={pathname()}>
			<SiteDirectory />
			<OnThisPage />
			<menu-toggle>
				<Toggle.Button
					ariaControls="site-directory on-this-page"
					ariaLabel="Documentation menu"
					checked={userHasToggled()}
					onClick={() => {
						setUserHasToggled((v) => !v)
					}}
				>
					☰
				</Toggle.Button>
			</menu-toggle>
		</docs-navigation>
	)
}

function OnThisPage(): VNode {
	let element: HTMLElement | null = null
	const attach = (node: HTMLElement | null) => {
		element = node
	}
	const userHasToggled = useValue(menuToggleAtom)

	const headings = useValue(headingsAtom)
	const setHeadings = useSetter(headingsAtom)
	const visibleHeadingIds = useValue(visibleHeadingIdsAtom)
	const setVisibleHeadingIds = useSetter(visibleHeadingIdsAtom)
	const visibleHeadingIdSet = () => new Set(visibleHeadingIds())
	const spotlightHeadingLinkIds = () => {
		const list = headings()
		const visible = visibleHeadingIdSet()
		const first = list.findIndex((heading) => visible.has(heading.id))
		let last = first
		list.forEach((heading, index) => {
			if (visible.has(heading.id)) last = index
		})
		return first === -1
			? []
			: list.slice(first, last + 1).map((heading) => `${heading.id}-link`)
	}
	const rootHeadingLevel = () =>
		headings().length
			? Math.min(...headings().map((heading) => heading.level))
			: 2

	onMount(() => {
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
			const headingDescriptors = headingElements.map((headingElement) => ({
				id: headingElement.id,
				content: headingElement.textContent,
				level: getHeadingLevel(headingElement),
			}))
			setHeadings(headingDescriptors)
			setVisibleHeadings(headingElements)
		}

		document.addEventListener(`astro:page-load`, gatherHeadings)
		gatherHeadings()

		addEventListener(`resize`, scheduleVisibleHeadingUpdate)
		addEventListener(`scroll`, scheduleVisibleHeadingUpdate, { passive: true })
		onCleanup(() => {
			document.removeEventListener(`astro:page-load`, gatherHeadings)
			removeEventListener(`resize`, scheduleVisibleHeadingUpdate)
			removeEventListener(`scroll`, scheduleVisibleHeadingUpdate)
			if (animationFrame !== null) {
				cancelAnimationFrame(animationFrame)
			}
		})
	})

	const renderHeadings = (
		list: readonly HeadingDescriptor[],
		level: number,
	): VNode[] => {
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
							data-section-visible={visibleHeadingIdSet().has(heading.id)}
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
		<on-this-page data-user-has-toggled={userHasToggled()}>
			<nav id="on-this-page" ref={attach}>
				<DynamicSpotlight
					elementId="on-this-page"
					padding={0}
					parent={() => element}
					variant="surface"
					hiddenAtViewportWidth={1280}
				/>
				<DynamicSpotlight
					elementIds={spotlightHeadingLinkIds()}
					parent={() => element}
				/>
				<section>
					<header>On this page</header>
					<main>{renderHeadings(headings(), rootHeadingLevel())}</main>
				</section>
			</nav>
		</on-this-page>
	)
}

function SiteDirectory(): VNode {
	let element: HTMLElement | null = null
	const attach = (node: HTMLElement | null) => {
		element = node
	}
	const userHasToggled = useValue(menuToggleAtom)
	const pathname = useValue(pathnameAtom)
	const pathnameId = () =>
		(pathname().endsWith(`/`) ? pathname().slice(0, -1) : pathname()).replaceAll(
			`/`,
			`-`,
		) + `-link`
	return (
		<site-directory data-user-has-toggled={userHasToggled()}>
			<nav id="site-directory" ref={attach}>
				<DynamicSpotlight
					elementId="site-directory"
					padding={0}
					parent={() => element}
					variant="surface"
					hiddenAtViewportWidth={960}
				/>
				<DynamicSpotlight elementId={pathnameId()} parent={() => element} />
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
					<header>Patterns</header>
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
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a id="-docs-atom-io-link" href={`/docs/atom-io`}>
								atom.io
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a id="-docs-web-link" href={`/docs/web`}>
								<low-emphasis>atom.io</low-emphasis>/web
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a id="-docs-transceivers-link" href={`/docs/transceivers`}>
								<low-emphasis>atom.io</low-emphasis>/transceivers
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>React</header>
					<main>
						<section>
							<a id="-docs-react-link" href="/docs/react">
								<low-emphasis>@atom.io</low-emphasis>/react
							</a>
						</section>
						<section>
							<a
								id="-docs-against-use-effect-link"
								href="/docs/against-use-effect"
							>
								against useEffect
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Other Integrations</header>
					<main>
						<section>
							<a id="-docs-solid-link" href="/docs/solid">
								<low-emphasis>@atom.io</low-emphasis>/solid
							</a>
						</section>
						<section>
							<span aria-disabled="true">???</span>
						</section>
					</main>
				</section>
				<section>
					<header>Tooling</header>
					<main>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a id="-docs-testing-link" href={`/docs/testing`}>
								<low-emphasis>atom.io</low-emphasis>/testing
							</a>
						</section>
						<section>
							<a id="-docs-eslint-plugin-link" href={`/docs/eslint-plugin`}>
								<low-emphasis>@atom.io</low-emphasis>/eslint-plugin
							</a>
						</section>
						<section>
							<a id="-docs-react-devtools-link" href={`/docs/react-devtools`}>
								<low-emphasis>@atom.io</low-emphasis>/react-devtools
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Realtime</header>
					<main>
						<section>
							<a id="-docs-realtime-link" href="/docs/realtime">
								overview
							</a>
						</section>
						<section>
							<a id="-docs-realtime-rigid-link" href="/docs/realtime/rigid">
								rigid
							</a>
						</section>
						<section>
							<a id="-docs-realtime-mosaic-link" href="/docs/realtime/mosaic">
								atomic mosaic
							</a>
						</section>
						<section>
							<a id="-docs-realtime-domains-link" href="/docs/realtime/domains">
								mosaic domains
							</a>
						</section>
						<section>
							<a id="-docs-realtime-text-link" href="/docs/realtime/text">
								mosaic text
							</a>
						</section>
						<section>
							<a id="-docs-realtime-client-link" href="/docs/realtime-client">
								<low-emphasis>@atom.io</low-emphasis>/realtime/client
							</a>
						</section>
						<section>
							<a id="-docs-realtime-react-link" href="/docs/realtime-react">
								<low-emphasis>@atom.io</low-emphasis>/realtime/react
							</a>
						</section>
						<section>
							<a id="-docs-realtime-server-link" href="/docs/realtime-server">
								<low-emphasis>@atom.io</low-emphasis>/realtime/server
							</a>
						</section>
						<section>
							<a id="-docs-realtime-testing-link" href="/docs/realtime-testing">
								<low-emphasis>@atom.io</low-emphasis>/realtime/testing
							</a>
						</section>
						<section>
							<a
								id="-docs-realtime-operations-link"
								href="/docs/realtime/operations"
							>
								operations and security
							</a>
						</section>
						<section>
							<a
								id="-docs-realtime-reference-link"
								href="/docs/realtime/reference"
							>
								component reference
							</a>
						</section>
					</main>
				</section>
				<section>
					<header>Foundations</header>
					<main>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a id="-docs-foundations-link" href={`/docs/foundations`}>
								<low-emphasis>atom.io</low-emphasis>/foundations
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-json-link"
								href={`/docs/foundations/json`}
							>
								<low-emphasis>foundations</low-emphasis>/json
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-canonical-link"
								href={`/docs/foundations/canonical`}
							>
								<low-emphasis>foundations</low-emphasis>/canonical
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-entries-link"
								href={`/docs/foundations/entries`}
							>
								<low-emphasis>foundations</low-emphasis>/entries
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-enumeration-link"
								href={`/docs/foundations/enumeration`}
							>
								<low-emphasis>foundations</low-emphasis>/enumeration
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-type-utils-link"
								href={`/docs/foundations/type-utils`}
							>
								<low-emphasis>foundations</low-emphasis>/type-utils
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-future-link"
								href={`/docs/foundations/future`}
							>
								<low-emphasis>foundations</low-emphasis>/future
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-subject-link"
								href={`/docs/foundations/subject`}
							>
								<low-emphasis>foundations</low-emphasis>/subject
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
							<a
								id="-docs-foundations-overlays-link"
								href={`/docs/foundations/overlays`}
							>
								<low-emphasis>foundations</low-emphasis>/overlays
							</a>
						</section>
						<section>
							<scope-placeholder aria-hidden="true">@</scope-placeholder>
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

DocsNavigation.createStore = createSiteStore
