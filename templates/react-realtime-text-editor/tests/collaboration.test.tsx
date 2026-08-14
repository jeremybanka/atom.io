import { act, waitFor } from "@testing-library/react"
import { useO } from "atom.io/react"
import type { Socket, UserKey } from "atom.io/realtime"
import { useMosaic } from "atom.io/realtime-react"
import { createMosaicServer } from "atom.io/realtime-server"
import * as RTTest from "atom.io/realtime-testing"

import { markdownAtomRegistration } from "../node/mosaic-atom.ts"
import {
	Markdown,
	markdownAtom,
	markdownWordCountSelector,
	type MarkdownPresence,
} from "../src/collaboration/mosaic.ts"
import type { Identity } from "../src/identities.ts"
import { INITIAL_MARKDOWN } from "../src/initial-markdown.ts"

const JANE = { id: `jane`, name: `Jane`, color: `#7057ff` } satisfies Identity
const DAVE = { id: `dave`, name: `Dave`, color: `#df527c` } satisfies Identity

function identityFor(userKey: UserKey): Identity {
	return userKey.includes(`jane`) ? JANE : DAVE
}

function testClient(identity: Identity, session: string) {
	return function TestClient() {
		const mosaic = useMosaic<InstanceType<typeof Markdown>, MarkdownPresence>(
			markdownAtom,
			{ actor: identity.id, session },
		)
		const document = useO(markdownAtom)
		const wordCount = useO(markdownWordCountSelector)
		const text = document.text
		const history = document.historyFor(identity.id)
		return (
			<main>
				<output data-testid="text">{text}</output>
				<output data-testid="word-count">{wordCount}</output>
				<output data-testid="status">{mosaic.status}</output>
				<output data-testid="presence">
					{mosaic.presence
						.map(({ actor }) => actor)
						.sort()
						.join(`,`)}
				</output>
				<button
					type="button"
					data-testid="append"
					onClick={() =>
						mosaic.change({
							text: `${text}[${identity.name}]`,
							type: `replace-text`,
						})
					}
				/>
				<button
					type="button"
					data-testid="presence-update"
					onClick={() => {
						mosaic.publishPresence({
							color: identity.color,
							lastActiveAt: 1,
							name: identity.name,
							selection: document.selectionFromOffsets(0, 0),
						})
					}}
				/>
				<button
					type="button"
					data-testid="undo"
					disabled={history.undo.length === 0}
					onClick={() => mosaic.change({ type: `undo` })}
				/>
				<button
					type="button"
					data-testid="redo"
					disabled={history.redo.length === 0}
					onClick={() => mosaic.change({ type: `redo` })}
				/>
			</main>
		)
	}
}

function scenario() {
	const collaboration = createMosaicServer({
		registrations: [markdownAtomRegistration],
	})
	const room = RTTest.multiClient({
		scenarioId: `mosaic-markdown`,
		server: ({ sessionId, socket, userKey }) => {
			const dispose = collaboration.connect({
				actor: identityFor(userKey).id,
				session: sessionId,
				socket: socket as unknown as Socket,
			})
			return () => {
				void dispose()
			}
		},
		clients: {
			jane: testClient(JANE, `test:jane`),
			dave: testClient(DAVE, `test:dave`),
		},
	})
	return {
		...room,
		teardown: async (): Promise<void> => {
			await room.teardown()
			await collaboration.dispose()
		},
	}
}

const initJane = (room: ReturnType<typeof scenario>) =>
	room.clients.jane.init({
		sessionId: `test:jane`,
		userKey: `user::jane`,
	})

const initDave = (room: ReturnType<typeof scenario>) =>
	room.clients.dave.init({
		sessionId: `test:dave`,
		userKey: `user::dave`,
	})

async function expectText(
	client: RTTest.RealtimeTestClient,
	text: string,
): Promise<void> {
	await waitFor(() => {
		expect(client.renderResult.getByTestId(`text`).textContent).toBe(text)
	})
}

async function expectStatus(
	client: RTTest.RealtimeTestClient,
	status: string,
): Promise<void> {
	await waitFor(() => {
		expect(client.renderResult.getByTestId(`status`).textContent).toBe(status)
	})
}

describe(`realtime collaborative Markdown`, () => {
	test(`offline concurrent edits rebase and converge for both clients`, async () => {
		const room = scenario()
		const jane = initJane(room)
		const dave = initDave(room)
		await expectText(jane, INITIAL_MARKDOWN)
		await expectText(dave, INITIAL_MARKDOWN)

		act(() => {
			jane.socket.disconnect()
			dave.socket.disconnect()
		})
		await expectStatus(jane, `offline`)
		await expectStatus(dave, `offline`)
		act(() => {
			jane.renderResult.getByTestId(`append`).click()
			dave.renderResult.getByTestId(`append`).click()
		})

		act(() => {
			jane.socket.connect()
			dave.socket.connect()
		})
		await waitFor(() => {
			const janeText = jane.renderResult.getByTestId(`text`).textContent ?? ``
			const daveText = dave.renderResult.getByTestId(`text`).textContent ?? ``
			expect(janeText).toBe(daveText)
			expect(janeText).toContain(`[Jane]`)
			expect(janeText).toContain(`[Dave]`)
			expect(jane.renderResult.getByTestId(`word-count`).textContent).toBe(
				dave.renderResult.getByTestId(`word-count`).textContent,
			)
		})
		await room.teardown()
	})

	test(`one identity's undo preserves a later foreign edit`, async () => {
		const room = scenario()
		const jane = initJane(room)
		const dave = initDave(room)
		await expectStatus(jane, `live`)
		await expectStatus(dave, `live`)

		act(() => {
			jane.renderResult.getByTestId(`append`).click()
		})
		await waitFor(() => {
			expect(dave.renderResult.getByTestId(`text`).textContent).toContain(
				`[Jane]`,
			)
		})
		act(() => {
			dave.renderResult.getByTestId(`append`).click()
		})
		await waitFor(() => {
			expect(jane.renderResult.getByTestId(`text`).textContent).toContain(
				`[Dave]`,
			)
		})

		act(() => {
			jane.renderResult.getByTestId(`undo`).click()
		})
		await waitFor(() => {
			const text = jane.renderResult.getByTestId(`text`).textContent ?? ``
			expect(text).not.toContain(`[Jane]`)
			expect(text).toContain(`[Dave]`)
			expect(dave.renderResult.getByTestId(`text`).textContent).toBe(text)
		})

		act(() => {
			jane.renderResult.getByTestId(`redo`).click()
		})
		await waitFor(() => {
			const text = jane.renderResult.getByTestId(`text`).textContent ?? ``
			expect(text).toContain(`[Jane]`)
			expect(text).toContain(`[Dave]`)
			expect(dave.renderResult.getByTestId(`text`).textContent).toBe(text)
		})
		await room.teardown()
	})

	test(`presence is model-aware and removed on disconnect`, async () => {
		const room = scenario()
		const jane = initJane(room)
		const dave = initDave(room)
		await expectStatus(jane, `live`)
		await expectStatus(dave, `live`)
		act(() => {
			jane.renderResult.getByTestId(`presence-update`).click()
			dave.renderResult.getByTestId(`presence-update`).click()
		})
		await waitFor(() => {
			expect(jane.renderResult.getByTestId(`presence`).textContent).toBe(
				`dave,jane`,
			)
		})

		act(() => {
			dave.socket.disconnect()
		})
		await waitFor(() => {
			expect(jane.renderResult.getByTestId(`presence`).textContent).toBe(`jane`)
		})
		await room.teardown()
	})
})
