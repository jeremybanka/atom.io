import { render, useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import type { JSAnimation } from "motion"
import { motionValue } from "motion"
import { expect, it, vi } from "vitest"

import { motionCapability } from "../src/motion.ts"
import { propertyTransition } from "../src/motion-transition.ts"
import { animateTween } from "../src/motion-tween.ts"

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
it(`samples authored keyframe times and segment easing and retargets from the current value`, () => {
	const value = motionValue<number | string>(0)
	const controls = animateTween(
		value,
		[0, 20, 40, 100],
		{
			type: `tween`,
			duration: 3,
			times: [0, 0.1, 0.77, 1],
			ease: [`circOut`, `linear`, `easeIn`],
		},
		false,
	)
	controls.pause()
	const sample = (seconds: number) =>
		(value.animation as JSAnimation<number | string>).sample(seconds * 1000)
	sample(0.3)
	expect(Number(value.get())).toBeCloseTo(20)
	sample(2.31)
	expect(Number(value.get())).toBeCloseTo(40)
	const current = value.get()
	const next = animateTween(
		value,
		[null, 60, 0],
		{ type: `tween`, duration: 1 },
		true,
	)
	next.pause()
	sample(0)
	expect(value.get()).toBe(current)
	sample(1)
	expect(value.get()).toBe(0)
	next.stop()
	value.destroy()
})
it.each([
	[0, [null, `100px`], `50px`, `100px`],
	[0, [0, `100px`, 0], `50px`, `0px`],
	[`100px`, [null, 0], `50px`, `0px`],
	[0, [null, `100%`], `50%`, `100%`],
	[0, [null, `90deg`], `45deg`, `90deg`],
] as const)(
	`interpolates compatible numeric and CSS keyframes from %s through %j`,
	(current, frames, midpoint, final) => {
		const value = motionValue<number | string>(current)
		const controls = animateTween(
			value,
			frames,
			{ type: `tween`, duration: 2, ease: `linear` },
			false,
		)
		controls.pause()
		try {
			const animation = value.animation as JSAnimation<number | string>
			animation.sample(frames.length === 3 ? 500 : 1000)
			expect(value.get()).toBe(midpoint)
			if (frames.length === 3) {
				animation.sample(1500)
				expect(value.get()).toBe(midpoint)
			}
			animation.sample(2000)
			expect(value.get()).toBe(final)
		} finally {
			controls.stop()
			value.destroy()
		}
	},
)
it.each([
	{ delay: -0.25 },
	{ default: { delay: -0.25 } },
	{ properties: { x: { delay: -0.25 } } },
])(
	`starts ordinary animations partway through a negative delay (%j)`,
	(config) => {
		const values = { x: 0 }
		const binding = motionCapability({ reducedMotion: `never` }).attach({
			kind: `scene`,
			node: values,
			read: () => values.x,
			write(_, value) {
				values.x = value as number
			},
		})
		try {
			binding.update({
				animate: { x: 100 },
				transition: { type: `tween`, duration: 1, ease: `linear`, ...config },
			})
			const value = motionValue<number | string>(0)
			const controls = animateTween(
				value,
				100,
				propertyTransition(
					{ type: `tween`, duration: 1, ease: `linear`, ...config },
					`x`,
				),
				false,
			)
			controls.pause()
			try {
				const animation = value.animation as JSAnimation<number | string>
				animation.sample(0)
				expect(value.get()).toBeCloseTo(25)
				animation.sample(250)
				expect(value.get()).toBeCloseTo(50)
				animation.sample(750)
				expect(value.get()).toBe(100)
			} finally {
				controls.stop()
				value.destroy()
			}
		} finally {
			binding.dispose()
		}
	},
)
it(`resolves property, default, and root options and diagnoses invalid timing combinations`, () => {
	expect(
		propertyTransition(
			{
				duration: 3,
				ease: `linear`,
				default: { duration: 2 },
				properties: { x: { duration: 1 } },
			},
			`x`,
			[0, 1, 2],
		),
	).toMatchObject({ duration: 1, ease: `linear`, type: `tween` })
	expect(
		propertyTransition({ duration: 3, default: { duration: 2 } }, `opacity`),
	).toMatchObject({ duration: 2 })
	for (const [config, frames] of [
		[{ times: [0, 1] }, [0, 1, 2]],
		[{ times: [0, 0.8, 0.4, 1] }, [0, 1, 2, 3]],
		[{ ease: [`linear`] }, [0, 1, 2]],
		[{ type: `spring` }, [0, 1, 2]],
		[{ duration: Infinity }, [0, 1]],
		[{ duration: -1 }, [0, 1]],
		[{ delay: -Infinity }, [0, 1]],
		[{ delay: Infinity }, [0, 1]],
		[{ delay: NaN }, [0, 1]],
		[{}, [0, null]],
	] as const)
		expect(() => propertyTransition(config as any, `x`, frames)).toThrow(
			`spa/motion:`,
		)
})
it(`reduced motion applies the final frame and disposal restores native styles`, async () => {
	const element = document.createElement(`div`)
	element.style.opacity = `0.4`
	document.body.append(element)
	const binding = motionCapability({ reducedMotion: `always` }).attach({
		kind: `dom`,
		node: element,
	})
	try {
		binding.update({
			animate: { x: [`-1500%`, `2%`, `4%`, `1500%`], opacity: [0, 1, 0] },
			transition: { duration: 3 },
		})
		await wait()
		expect(element.style.transform).toContain(`1500%`)
		expect(element.style.opacity).toBe(`0`)
		binding.update({ animate: { x: 50, opacity: 1 } })
		await wait()
		expect(element.style.transform).toContain(`50px`)
	} finally {
		binding.dispose()
		expect(element.style.opacity).toBe(`0.4`)
		element.remove()
	}
})
it(`retains and revives keyed sequence exits without stale completion and stops work on root disposal`, async () => {
	const silo = new Silo({
		name: `keyframes`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const host = document.createElement(`section`)
	document.body.append(host)
	const setup = vi.fn()
	function App() {
		const getVisible = useGetter(visibleAtom)
		return <>{getVisible() && <Panel key="panel" />}</>
	}
	function Panel() {
		setup()
		return (
			<div
				motion:initial={{ x: 0 }}
				motion:animate={{ x: [null, 20, 0] }}
				motion:exit={{ x: [null, 40, 60] }}
				motion:transition={{ duration: 0.1 }}
			/>
		)
	}
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `never` })],
	})
	try {
		const element = host.querySelector(`div`)!
		silo.setState(visibleAtom, false)
		root.flush()
		expect(element.isConnected).toBe(true)
		await wait()
		silo.setState(visibleAtom, true)
		root.flush()
		await wait(140)
		expect(host.querySelector(`div`)).toBe(element)
		expect(setup).toHaveBeenCalledOnce()
		root.dispose()
		await wait()
		expect(host.querySelector(`div`)).toBe(null)
		expect(element.style.transform).toBe(``)
	} finally {
		root.dispose()
		host.remove()
	}
})
