---
"atom.io": patch
---

Keep shared selector subscriptions active until their last consumer unsubscribes, and notify subscribers of readonly and writable held selectors when their source atoms change. Preserve one upstream listener per selector and source atom, dynamic dependency tracking, and settled transaction notifications.
