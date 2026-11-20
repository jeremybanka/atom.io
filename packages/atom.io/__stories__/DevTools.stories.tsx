import "@atom.io/devtools/css"

import type { Meta, StoryObj } from "@storybook/react-vite"

import {
	playEcologySandbox,
	playEcologySearch,
	playOrderActions,
	playOrderEditingAndReset,
	playOrderRoots,
	playPrimary,
	playStorefront,
	playSurfaceStates,
} from "./devtools-story-interactions.ts"
import { OrderFulfillment } from "./OrderFulfillment.tsx"
import { OrderSummary } from "./OrderSummary.tsx"
import { PrimaryDevtools } from "./PrimaryDevtools.tsx"

const meta: Meta<typeof PrimaryDevtools> = {
	title: "AtomIODevtools",
	component: PrimaryDevtools,
	subcomponents: { OrderSummary },
	parameters: { layout: "fullscreen" },
	tags: ["autodocs"],
}
export default meta

type Story = StoryObj<typeof meta>
export const Primary: Story = { play: playPrimary }
export const EcologySandbox: Story = {
	render: () => <OrderFulfillment />,
	play: playEcologySandbox,
}
export const EcologyOrderFulfillment: Story = {
	render: () => <OrderFulfillment />,
	play: playOrderRoots,
}
export const OrderActions: Story = {
	render: () => <OrderFulfillment />,
	play: playOrderActions,
}
export const OrderEditingAndReset: Story = {
	render: () => <OrderFulfillment />,
	play: playOrderEditingAndReset,
}

export const EcologySearch: Story = {
	render: () => <OrderFulfillment />,
	play: playEcologySearch,
}

export const SurfaceStates: Story = {
	render: () => <OrderFulfillment />,
	play: playSurfaceStates,
}

export const Storefront: Story = {
	render: () => <OrderFulfillment />,
	play: playStorefront,
}
