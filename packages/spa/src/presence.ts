import type { CapabilityBinding } from "./capabilities.ts"
import type { Cleanup, Root, Scope } from "./core.ts"
import {
	dispose,
	invalidate,
	isPresent,
	reportScopeError,
	untrack,
} from "./core.ts"

export interface ExitHandle {
	finished: Promise<void>
	cancel(): void
}
export interface ExitParticipant {
	exit(): ExitHandle | undefined
	resume(): void
}
export interface PresenceTarget {
	kind: string
	node: unknown
	suspend?(): Cleanup
}
interface PresenceCollection<T, V> {
	take(key: unknown, value: V): T | undefined
	remove(
		record: T,
		key: unknown,
		eligible: boolean,
		index: number,
		done: Cleanup,
	): void
	merge(records: T[]): T[]
}
export interface PresenceCoordinator {
	collection<T, V>(
		scope: (record: T) => Scope,
		compatible: (record: T, value: V) => boolean,
	): PresenceCollection<T, V>
	target(scope: Scope, target: PresenceTarget): void
	bind(
		scope: Scope,
		binding: CapabilityBinding,
		read: () => Record<string, unknown>,
		namespace: string,
	): void
	unbind(binding: CapabilityBinding): void
	event(scope: Scope, handler: Function): Function
	remove(scope: Scope, done: Cleanup): boolean
	resume(scope: Scope): void
	forget(scope: Scope): void
}
interface Session {
	scope: Scope
	participant: ExitParticipant
	handle: ExitHandle
	done: boolean
	cancelled: boolean
}
interface Group {
	scope: Scope
	sessions: Session[]
	done: Cleanup
}

/** Optional coordinator: only imported by integrations that support retention. */
export function createPresence(root: Root): PresenceCoordinator {
	const releases = new Map<CapabilityBinding, Cleanup>()
	const handlers = new WeakMap<Scope, WeakMap<Function, Function>>()
	// Groups own absent ranges; sessions can be shared when a parent adopts a child exit.
	const groups = new Map<Scope, Group>()
	const sessions = new Set<Session>()
	const active = new Map<ExitParticipant, Session>()
	const suspended = new Map<PresenceTarget, { scope: Scope; restore: Cleanup }>()
	const suspend = (target: PresenceTarget): Cleanup => {
		if (target.kind !== `dom`) return target.suspend!()
		const node = target.node as HTMLElement
		const inert = node.getAttribute(`inert`),
			hidden = node.getAttribute(`aria-hidden`)
		const pointer = node.style.getPropertyValue(`pointer-events`),
			priority = node.style.getPropertyPriority(`pointer-events`)
		const focused = node.ownerDocument.activeElement as HTMLElement | null
		if (focused && node.contains(focused)) focused.blur()
		node.setAttribute(`inert`, ``)
		node.setAttribute(`aria-hidden`, `true`)
		node.style.setProperty(`pointer-events`, `none`, `important`)
		return () => {
			for (const [key, value] of [
				[`inert`, inert],
				[`aria-hidden`, hidden],
			] as const) {
				if (value === null) node.removeAttribute(key)
				else node.setAttribute(key, value)
			}
			if (pointer) node.style.setProperty(`pointer-events`, pointer, priority)
			else node.style.removeProperty(`pointer-events`)
		}
	}
	const walk = (scope: Scope, visit: (scope: Scope) => void) => {
		const descend = (at: Scope) => {
			visit(at)
			for (const child of at._cleanups)
				if (typeof child !== `function`) descend(child)
		}
		descend(scope)
	}
	const ancestor = (scope: Scope, parent: Scope) => {
		for (let at: Scope | undefined = scope; at; at = at._parent)
			if (at === parent) return true
		return false
	}
	const finish = () => {
		for (const group of [...groups.values()]) {
			if (group.scope._dead || group.sessions.some((session) => !session.done))
				continue
			if (
				[...groups.keys()].some(
					(scope) => scope !== group.scope && ancestor(group.scope, scope),
				)
			)
				continue
			groups.delete(group.scope)
			try {
				group.done()
			} catch (error) {
				if (!root._dead) reportScopeError(group.scope, error)
			}
		}
	}
	const cancel = (session: Session) => {
		session.cancelled = true
		sessions.delete(session)
		active.delete(session.participant)
		session.handle.cancel()
	}
	const coordinator: PresenceCoordinator = {
		target(scope, target) {
			;(scope._targets ??= new Set()).add(target)
			scope._cleanups.add(() => {
				scope._targets!.delete(target)
			})
		},
		bind(scope, binding, props, namespace) {
			const read = () =>
				Object.fromEntries(
					Object.entries(props())
						.filter(([key]) => key.startsWith(`${namespace}:`))
						.map(([key, value]) => [key.slice(namespace.length + 1), value]),
				)
			if (!binding.exit) return
			const participant = {
				exit: () => binding.exit!(untrack(read)),
				resume() {
					binding.update(untrack(read))
					binding.resume?.()
				},
			}
			;(scope._exits ??= new Set()).add(participant)
			const release = () => {
				scope._exits!.delete(participant)
				scope._cleanups.delete(release)
				releases.delete(binding)
			}
			releases.set(binding, release)
			scope._cleanups.add(release)
		},
		unbind(binding) {
			releases.get(binding)?.()
		},
		event(scope, handler) {
			const cached = handlers.get(scope) ?? new WeakMap<Function, Function>()
			handlers.set(scope, cached)
			if (!cached.has(handler))
				cached.set(handler, function (this: unknown, ...args: unknown[]) {
					if (isPresent(scope)) return handler.apply(this, args)
				})
			return cached.get(handler)!
		},
		collection<T, V>(
			scopeOf: (record: T) => Scope,
			compatible: (record: T, value: V) => boolean,
		): PresenceCollection<T, V> {
			let order: T[] = []
			const exiting = new Map<
				T,
				{ key: unknown; eligible: boolean; index: number }
			>()
			return {
				take(key, value) {
					// Empty conditional children do not replace an exiting generation.
					if (value == null || typeof value === `boolean`) return undefined
					for (const [record, state] of exiting)
						if (state.eligible && state.key === key) {
							if (!compatible(record, value)) {
								state.eligible = false
								return undefined
							}
							exiting.delete(record)
							return record
						}
					return undefined
				},
				remove(record, key, eligible, index, done) {
					const position = order.indexOf(record)
					const state = { key, eligible, index: position < 0 ? index : position }
					exiting.set(record, state)
					let pending = false
					const release = () => {
						dispose(scopeOf(record))
						exiting.delete(record)
						order = order.filter((item) => item !== record)
						for (const other of exiting.values())
							if (other.index > state.index) other.index--
						if (pending) done()
					}
					pending = coordinator.remove(scopeOf(record), release)
					if (!pending) release()
				},
				merge(records) {
					const rendered = [...records]
					for (const [record, state] of [...exiting].sort(
						(a, b) => a[1].index - b[1].index,
					)) {
						rendered.splice(Math.min(state.index, rendered.length), 0, record)
						state.index = rendered.indexOf(record)
					}
					// DOM reconciliation reverses its result while moving ranges. Keep a snapshot.
					order = [...rendered]
					return rendered
				},
			}
		},
		remove(scope, done) {
			const collected: Session[] = []
			walk(scope, (at) => {
				for (const participant of at._exits ?? []) {
					let session = active.get(participant)
					if (!session) {
						const handle = untrack(() => participant.exit())
						if (!handle) continue
						session = {
							scope: at,
							participant,
							handle,
							done: false,
							cancelled: false,
						}
						sessions.add(session)
						active.set(participant, session)
						const held = session
						void handle.finished.then(
							() => {
								if (held.cancelled || root._dead) return
								held.done = true
								finish()
							},
							(error) => {
								if (!held.cancelled && !root._dead)
									reportScopeError(held.scope, error)
							},
						)
					}
					collected.push(session)
				}
			})
			if (!collected.some((session) => !session.done)) return false
			scope._exiting = true
			groups.set(scope, { scope, sessions: collected, done })
			walk(scope, (at) => {
				for (const target of at._targets ?? [])
					if (
						!suspended.has(target) &&
						(target.kind === `dom` || target.suspend)
					)
						suspended.set(target, { scope: at, restore: suspend(target) })
			})
			return true
		},
		resume(scope) {
			if (!groups.delete(scope)) return
			scope._exiting = false
			for (const session of [...sessions])
				if (ancestor(session.scope, scope) && isPresent(session.scope)) {
					cancel(session)
				}
			walk(scope, (at) => {
				if (isPresent(at))
					for (const participant of at._exits ?? []) participant.resume()
			})
			for (const [target, state] of suspended)
				if (isPresent(state.scope)) {
					suspended.delete(target)
					state.restore()
				}
			invalidate(scope)
			// Reconcile returning descendants before releasing their adopted, completed exits.
			queueMicrotask(finish)
		},
		forget(scope) {
			const errors: unknown[] = []
			for (const session of [...sessions])
				if (ancestor(session.scope, scope)) {
					try {
						cancel(session)
					} catch (error) {
						errors.push(error)
					}
				}
			for (const at of groups.keys()) if (ancestor(at, scope)) groups.delete(at)
			for (const [target, state] of suspended)
				if (ancestor(state.scope, scope)) {
					suspended.delete(target)
					try {
						state.restore()
					} catch (error) {
						errors.push(error)
					}
				}
			if (errors.length) throw new AggregateError(errors)
		},
	}
	return coordinator
}
