# Motion examples

Run pnpm --filter @atom.io/spa example:motion from the repository root after building @atom.io/spa and its workspace dependencies. Vite prints the local sandbox URL. This example runs independently of atom.io.fyi; the website imports the same MotionLab component and stylesheet.

MotionSandbox.tsx demonstrates interruption of a moving tween with adjustable duration and easing. ToastSandbox.tsx demonstrates a 240ms fade and shrink toward 85% scale, interrupted by a spring return. Both include manual controls and slow motion.

MotionLab.tsx composes the examples and registers the root's optional Motion capability. main.tsx mounts it with SPA's renderer. The shared motion-sandbox-debug.ts observes rendered DOM values, draws ghost trails and velocity plots, and supports frame scrubbing and PNG/JSON exports.

Run pnpm --filter @atom.io/spa test:browser:motion for Chromium checks of identity, interruption, resource cleanup, captures, and mobile layout. Generated screenshots and frame data are written to the temporary directory and uploaded by browser CI.
