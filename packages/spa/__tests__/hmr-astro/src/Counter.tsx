import { createStore } from "./state.ts"
import View from "./View.tsx"

const Counter = Object.assign(View, { createStore })
export default Counter
