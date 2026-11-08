---
"@atom.io/spa": patch
"atom.io": patch
---

Avoid hydration mismatches when resumability is installed alongside ordinary async defaults: check the server view's state reads before hydration and mount against browser loading state when a read remains pending. Preserve DOM hydration for synchronous resumed values, including cached reads and mixed async/resumable views. Cancel private server preparation and renderer lifetimes with the request, releasing resources even when pending work ignores cancellation.
