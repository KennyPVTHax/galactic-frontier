/**
 * Presentation facade for cinematic deep space. The FULL package re-exports the real implementation; the LITE (Telegram) build
 * redirects this module to cinematic.lite.ts (see scripts/build.mjs) so none of it ships in the Telegram bundle.
 */
export { CinematicSpace, cinematicCeiling } from "./full/cinematicSpace";
export type { CinematicLevel, CinematicContext, CinematicChange } from "./full/cinematicController";
