/**
 * Presentation facade for the on-foot character. FULL gets the detailed realistic astronaut; the LITE (Telegram) build
 * redirects this module to astronaut.lite.ts (see scripts/build.mjs) and keeps the simple, cheap model.
 */
export { AstronautFull as Astronaut } from "./full/astronautFull";
