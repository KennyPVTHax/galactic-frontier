/**
 * Presentation facade for the on-foot character. FULL gets the hero astronaut (an authored GLB when shipped, with the procedural
 * astronaut as a safe fallback); the LITE (Telegram) build redirects this module to astronaut.lite.ts (see scripts/build.mjs) and keeps
 * the simple, cheap model — the glTF loader and every hero asset stay out of the Lite package.
 */
export { AstronautHero as Astronaut } from "./full/astronautHero";
