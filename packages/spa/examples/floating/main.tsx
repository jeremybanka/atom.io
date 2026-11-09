import "./style.css"

import { render, useGetter, useRef, useSetter } from "@atom.io/spa"
import { floatingCapability } from "@atom.io/spa/floating"
import { motionCapability } from "@atom.io/spa/motion"
import { flip, offset, shift } from "@floating-ui/dom"
import { Silo } from "atom.io"

const silo = new Silo({
	name: `floating-lab`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const openAtom = silo.atom<boolean>({ key: `open`, default: true })
const movedAtom = silo.atom<boolean>({ key: `moved`, default: false })
const alternateAtom = silo.atom<boolean>({ key: `alternate`, default: false })
const transformedAtom = silo.atom<boolean>({ key: `transformed`, default: true })
const enabledAtom = silo.atom<boolean>({ key: `enabled`, default: true })
const fixedAtom = silo.atom<boolean>({ key: `fixed`, default: true })
const anchorAtom = silo.atom<HTMLButtonElement | null>({
	key: `anchor`,
	default: null,
})
const cornerAtom = silo.atom<HTMLButtonElement | null>({
	key: `corner`,
	default: null,
})
const middleware = [offset(12), flip(), shift({ padding: 12 })]

function FloatingLab() {
	const getOpen = useGetter(openAtom)
	const setOpen = useSetter(openAtom)
	const getMoved = useGetter(movedAtom)
	const setMoved = useSetter(movedAtom)
	const getAlternate = useGetter(alternateAtom)
	const setAlternate = useSetter(alternateAtom)
	const getTransformed = useGetter(transformedAtom)
	const setTransformed = useSetter(transformedAtom)
	const getEnabled = useGetter(enabledAtom)
	const setEnabled = useSetter(enabledAtom)
	const getFixed = useGetter(fixedAtom)
	const setFixed = useSetter(fixedAtom)
	const getAnchor = useGetter(anchorAtom)
	const attachAnchor = useRef(anchorAtom)
	const getCorner = useGetter(cornerAtom)
	const attachCorner = useRef(cornerAtom)
	return (
		<>
			<h1>Floating + Motion</h1>
			<p>
				One element: Floating anchors it with translate; Motion animates its
				transform.
			</p>
			<nav aria-label="Experiment controls">
				<button
					id="toggle"
					onClick={() => {
						setOpen((value) => !value)
					}}
				>
					Toggle overlay
				</button>
				<button
					id="move"
					onClick={() => {
						setMoved((value) => !value)
					}}
				>
					Move anchor
				</button>
				<button
					id="alternate"
					onClick={() => {
						setAlternate((value) => !value)
					}}
				>
					Switch anchor
				</button>
				<button
					id="transform"
					onClick={() => {
						setTransformed((value) => !value)
					}}
				>
					Toggle scale + rotation
				</button>
				<button
					id="enabled"
					onClick={() => {
						setEnabled((value) => !value)
					}}
				>
					Toggle positioning
				</button>
				<button
					id="strategy"
					onClick={() => {
						setFixed((value) => !value)
					}}
				>
					Switch fixed / absolute
				</button>
			</nav>
			<div class="scroller">
				<div class="stage">
					<button
						id="anchor"
						ref={attachAnchor}
						motion:animate={{ x: getMoved() ? 120 : 0, y: getMoved() ? 30 : 0 }}
						motion:transition={{ type: `tween`, duration: 0.3 }}
					>
						Scroll around me
					</button>
				</div>
			</div>
			<button id="corner" ref={attachCorner}>
				Corner anchor
			</button>
			{getOpen() && (
				<aside
					key="overlay"
					id="overlay"
					aria-label="Floating preview"
					floating:reference={getAlternate() ? getCorner() : getAnchor()}
					floating:enabled={getEnabled()}
					floating:placement="bottom-start"
					floating:strategy={getFixed() ? `fixed` : `absolute`}
					floating:middleware={middleware}
					floating:autoUpdate={{ animationFrame: true }}
					motion:initial={{ opacity: 0, y: -8, scale: 0.8, rotate: -8 }}
					motion:animate={{
						opacity: 1,
						y: getTransformed() ? -8 : 0,
						scale: getTransformed() ? 0.8 : 1,
						rotate: getTransformed() ? -8 : 0,
					}}
					motion:exit={{ opacity: 0, y: -20, scale: 0.6, rotate: -16 }}
					motion:transition={{ type: `tween`, duration: 0.6 }}
				>
					<strong>Anchored and animated</strong>
					<p>
						Scroll, move the anchor, or interrupt an exit. This card has no
						positioning wrapper.
					</p>
				</aside>
			)}
		</>
	)
}

const capabilities = [
	floatingCapability(),
	motionCapability({ reducedMotion: `never` }),
]
if (new URLSearchParams(location.search).has(`motion-first`))
	capabilities.reverse()
const root = render(() => <FloatingLab />, document.getElementById(`app`)!, {
	store: silo.store,
	capabilities,
})
document.getElementById(`dispose`)!.addEventListener(`click`, () => {
	root.dispose()
})
