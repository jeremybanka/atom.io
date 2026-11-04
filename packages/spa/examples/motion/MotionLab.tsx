import type { VNode } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"

import { MotionSandbox } from "./MotionSandbox.tsx"
import { ToastSandbox } from "./ToastSandbox.tsx"

/** Shared by the standalone example and the documentation site's host page. */
export function MotionLab(): VNode {
	return (
		<motion-lab>
			<header>
				<a href="https://atom.io.fyi/docs/spa">
					spa <span>/ motion lab</span>
				</a>
				<span className="edition">01 / INTERRUPTION STUDY</span>
			</header>
			<main>
				<section className="intro">
					<p className="eyebrow">CHANGE OF PLANS. SAME MOMENTUM.</p>
					<h1>
						A little <em>U-turn.</em>
					</h1>
					<p>
						A card starts to leave. You change your mind. It carries its
						momentum, slows to a stop, and comes back. Try it slowly; every frame
						leaves a trace.
					</p>
					<a className="example-link" href="#toast-dismissal">
						Try the toast dismissal ↓
					</a>
				</section>
				<MotionSandbox />
				<section id="toast-dismissal" aria-label="Toast dismissal example">
					<ToastSandbox />
				</section>
			</main>
			<footer>
				<a href="https://github.com/jeremybanka/atom.io/pull/1421">
					Presence lifecycle / #1405 ↗
				</a>
				<a href="https://atom.io.fyi/docs/spa">SPA documentation ↗</a>
			</footer>
		</motion-lab>
	)
}
MotionLab.capabilities = [motionCapability({ reducedMotion: `never` })]
