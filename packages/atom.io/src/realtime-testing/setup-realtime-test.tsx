import type { RenderResult } from "@testing-library/react"
import { prettyDOM, render } from "@testing-library/react"
import { toEntries } from "atom.io/foundations/entries"
import * as AR from "atom.io/react"
import * as RTR from "atom.io/realtime-react"
import * as Happy from "happy-dom"
import * as React from "react"

import type {
	HeadlessRealtimeTestClient,
	RealtimeTestAPI,
	RealtimeTestClientOptions,
	RealtimeTestServer,
	TestSetupOptions,
	WaitForIdleOptions,
} from "./headless/index.ts"
import { headless, setupHeadlessRealtimeTestClient } from "./headless/index.ts"

export type TestSetupOptions__SingleClient = TestSetupOptions & {
	client: React.FC
}

export type TestSetupOptions__MultiClient<ClientNames extends string> =
	TestSetupOptions & {
		clients: {
			[K in ClientNames]: React.FC
		}
	}

export type RealtimeTestClient = HeadlessRealtimeTestClient & {
	renderResult: RenderResult
	prettyPrint: () => void
}

export type RealtimeTestClientBuilder = {
	/** Dispose every still-live instance created by this builder. */
	dispose: () => Promise<void>
	/** Create a new independent instance. It is valid to call `init` repeatedly. */
	init: (options?: Partial<RealtimeTestClientOptions>) => RealtimeTestClient
	/** Wait for every still-live instance created by this builder. */
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
}

export type RealtimeTestAPI__SingleClient = RealtimeTestAPI & {
	client: RealtimeTestClientBuilder
}

export type RealtimeTestAPI__MultiClient<ClientNames extends string> =
	RealtimeTestAPI & {
		clients: Record<ClientNames, RealtimeTestClientBuilder>
	}

const renderClient = (
	Component: React.FC,
	headlessClient: HeadlessRealtimeTestClient,
): RealtimeTestClient => {
	const { document } = new Happy.Window()
	document.body.innerHTML = `<div id="app"></div>`
	const renderResult = render(
		<AR.StoreProvider store={headlessClient.silo.store}>
			<RTR.RealtimeProvider socket={headlessClient.socket}>
				<Component />
			</RTR.RealtimeProvider>
		</AR.StoreProvider>,
		{
			container: document.querySelector(`#app`) as unknown as HTMLElement,
		},
	)
	let disposed = false
	return {
		...headlessClient,
		dispose: async () => {
			if (disposed) return
			disposed = true
			renderResult.unmount()
			await headlessClient.dispose()
		},
		prettyPrint: () => {
			// eslint-disable-next-line no-console
			console.log(prettyDOM(renderResult.container))
		},
		renderResult,
	}
}

const createClientBuilder = (
	Component: React.FC,
	name: string,
	createClient: (
		options: RealtimeTestClientOptions,
	) => HeadlessRealtimeTestClient,
): RealtimeTestClientBuilder => {
	const instances = new Set<RealtimeTestClient>()
	return {
		dispose: async () => {
			await Promise.all([...instances].map((client) => client.dispose()))
			instances.clear()
		},
		init: (overrides = {}) => {
			const client = renderClient(
				Component,
				createClient({ name, ...overrides }),
			)
			const dispose = client.dispose
			client.dispose = async () => {
				try {
					await dispose()
				} finally {
					instances.delete(client)
				}
			}
			instances.add(client)
			return client
		},
		waitForIdle: async (options) => {
			for (const client of instances) await client.waitForIdle(options)
		},
	}
}

/** Create a React-rendered client builder against an existing test server. */
export const setupRealtimeTestClient = (
	options: TestSetupOptions__SingleClient,
	name: string,
	server: RealtimeTestServer,
): RealtimeTestClientBuilder =>
	createClientBuilder(options.client, name, (clientOptions) =>
		setupHeadlessRealtimeTestClient(clientOptions, server),
	)

export const singleClient = (
	options: TestSetupOptions__SingleClient,
): RealtimeTestAPI__SingleClient => {
	const scenario = headless(options)
	const client = createClientBuilder(
		options.client,
		`CLIENT`,
		scenario.createClient,
	)
	return {
		...scenario,
		client,
		teardown: async () => {
			try {
				await client.dispose()
			} finally {
				await scenario.teardown()
			}
		},
	}
}

export const multiClient = <ClientNames extends string>(
	options: TestSetupOptions__MultiClient<ClientNames>,
): RealtimeTestAPI__MultiClient<ClientNames> => {
	const scenario = headless(options)
	const clients = toEntries(options.clients).reduce(
		(record, [name, Component]) => {
			record[name] = createClientBuilder(Component, name, scenario.createClient)
			return record
		},
		{} as Record<ClientNames, RealtimeTestClientBuilder>,
	)
	return {
		...scenario,
		clients,
		teardown: async () => {
			try {
				for (const [, client] of toEntries(clients)) await client.dispose()
			} finally {
				await scenario.teardown()
			}
		},
	}
}
