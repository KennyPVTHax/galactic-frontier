# Android game screen (reference)

Not wired into the OrbitBtc Android release branch. Review before adopting.

- `GalacticFrontierActivity.kt`: isolated landscape game Activity. The main app keeps its own orientation;
  finishing this Activity returns to it.
- `AndroidManifest-snippet.xml`: manifest entry. `configChanges` prevents WebView reloads on rotation.

JS bridge (`window.OrbitBtcGame`), feature-detected by `src/platform/platform.ts`:

| Method | Purpose |
|---|---|
| `setLandscape(Boolean)` | Lock or unlock landscape while the game is active. |
| `haptic(ms)` | Touch feedback for game buttons and the throttle slider. |
| `exitGame()` | Close the game screen. |

The Activity also calls `window.__gfSetInsets(top, right, bottom, left)` (CSS px) with cutout and gesture insets,
and `window.__gfSave()` before leaving.

Security notes: only load OrbitBtc's own HTTPS origin, keep file access off, and expose no other methods.
On newer AndroidX WebKit, `WebViewCompat.addWebMessageListener` with an origin allow-list is a stricter alternative to `addJavascriptInterface`.
