import "@atom.io/spa-devtools/css"

import type { Meta, StoryObj } from "@storybook/react-vite"

import {
	playEcologySearch,
	playOrderActions,
	playOrderEditingAndReset,
	playOrderHistorySearch,
	playOrderRoots,
	playPrimary,
} from "./devtools-story-interactions.ts"
import { OrderFulfillment, OrderSummary } from "./OrderFulfillment.tsx"
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

export const OrderHistorySearch: Story = {
	render: () => <OrderFulfillment />,
	play: playOrderHistorySearch,
}

export const EcologySearch: Story = {
	render: () => <OrderFulfillment />,
	play: playEcologySearch,
}
