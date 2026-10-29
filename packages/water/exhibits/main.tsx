import { render } from "@atom.io/water"

import { PointEditor } from "./point.tsx"

const root = render(() => <PointEditor />, document.getElementById(`app`)!)
// Call root.dispose() when the application shell removes this root.
import.meta.hot?.dispose(root.dispose)
