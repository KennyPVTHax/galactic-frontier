# Real-device tests still required (M2)

Nothing below has been run on a physical device or inside a real Telegram client. Everything in the M2 report was
measured in headless Chromium with software WebGL (SwiftShader) and device *emulation*.

Record for each run: device model, OS version, browser / WebView / Telegram version, GPU (Settings → Performance stats
shows renderer-dependent tier), effective tier, and the overlay's fps / ms / draws / texture MB after 2 minutes of play.

## A. Android Ultra (high-end phone, e.g. Snapdragon 8 Gen 2+ / Dimensity 9200+ / Tensor G3+)

1. Auto tier resolves to **Android Ultra** (Settings shows the reason). If it shows a lower tier, note the GPU string.
2. Stable ≥ 30 fps on foot at Survey Site Alpha and in low flight for 10 minutes; note if 60 is reached.
3. After 10 minutes: does the governor reduce anything (overlay "reduced: …")? Device temperature by hand / OS warning.
4. Cascaded shadows: no flicker or swimming while walking; no shadow acne on the terrain.
5. No WebGL context loss when switching apps and returning (state must be intact).

## B. Android app (game Activity + WebView), mid and high-end devices

1. Opening the game screen rotates to landscape; leaving it restores the app's portrait UI.
2. Rotating the phone 180° (landscape ↔ reverse landscape) does not reload the WebView or reset progress.
3. HUD clears the camera cutout / punch hole on both landscape sides and the gesture bar at the bottom.
4. Left joystick near the screen edge does not trigger Android's back gesture.
5. Back button saves and closes the game screen; reopening shows "Continue" with the same progress.
6. Haptics on Mine / Jump / Use and throttle-slider detents.

## C. Android Chrome (no app)

1. "Begin expedition" enters fullscreen and locks landscape; the rotate prompt appears only if the lock fails.
2. Fullscreen button (top right) re-enters fullscreen after the user leaves it.
3. Touch: joystick, camera drag, all buttons reachable with thumbs; no accidental page zoom or pull-to-refresh.

## D. Telegram Mini App (Android and iOS, Bot API 8.0+ clients)

1. Auto tier = **Telegram Basic**; ≥ 30 fps on a mid-range phone.
2. Start tap: Mini App goes fullscreen; vertical swipes no longer minimise the app.
3. Holding the phone in landscape, then starting: orientation locks (Telegram locks the current orientation).
   Starting in portrait: rotate prompt; rotating to landscape then locks.
4. HUD clears Telegram's fullscreen header buttons (content safe area) and device cutouts.
5. Leaving the game (back / close) unlocks orientation and exits fullscreen.
6. Older Telegram client (< 8.0): game still works with expand + rotate prompt.
7. Backend: start + complete a mission with `X-Telegram-Init-Data`; server validates HMAC; reward message shown verbatim.

## E. iOS Safari / Telegram iOS

1. No orientation lock on iOS Safari: rotate prompt shows in portrait, disappears in landscape; "Play in portrait" works.
2. Notch and home-indicator insets respected in both landscape directions.
3. PC Enhanced default on recent iPhones: frame rate and memory (Safari tab reloads under memory pressure are a failure).

## F. PC

1. 1920×1080, 2560×1440, 2560×1080 and 3440×1440: HUD layout, ultrawide frame, field of view.
2. PC Enhanced default on integrated GPUs (Intel Iris Xe / AMD Radeon 680M): ≥ 50 fps target or governor reduces gracefully.
3. Ultra selectable on a discrete GPU; render-resolution slider and Adaptive toggle behave as labelled.

## G. Cross-platform account checks

1. Same OrbitBtc account on Telegram (Basic) and PC (Enhanced): one cloud save, same mission step and inventory;
   each device keeps its own graphics tier.
2. Completing the mission on any platform sends one completion report; a retried report is answered idempotently.
3. Gameplay numbers are identical across tiers (automated parity test passes in CI; spot-check mining time on device).
