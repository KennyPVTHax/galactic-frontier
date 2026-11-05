/**
 * Which presentation package this bundle is (set at build time by scripts/build.mjs via `__GF_PACKAGE__`).
 *
 *   "lite" — Galactic Frontier Lite, the Telegram Mini App: basic render profile only, no PBR / post pipeline / shadows.
 *   "full" — everything else (Android app, desktop, preview): all graphics tiers.
 *
 * The packages differ ONLY in presentation. They embed the same shared gameplay core, so `rulesFingerprint()` is identical.
 */
declare const __GF_PACKAGE__: "lite" | "full" | undefined;

export type PackageKind = "lite" | "full";
export const PACKAGE: PackageKind = typeof __GF_PACKAGE__ === "undefined" ? "full" : __GF_PACKAGE__;
export const IS_LITE: boolean = PACKAGE === "lite";
