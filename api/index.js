// Vercel's function entry point. `pnpm build` creates the workspace output
// before Vercel bundles this file, so the platform does not re-typecheck the
// entire source graph with a different compiler configuration.
export { default } from "../apps/api/dist/index.js";
