# Testing Galactic Frontier on a phone

Two ways to play the build from the `m7-build` GitHub Actions run. **Nobody has measured this build on a real phone yet — that is
what these steps are for.** Do not quote any frame rate as "Android performance" until you have a report from your own device.

## A. Android test app (debug APK) — recommended

The APK is a minimal WebView shell around the game. It is landscape-only, has **no internet permission** (it cannot contact any
server), and uses its own app id `com.orbitbtc.galacticfrontier.standalone.debug`, so it installs next to — and never replaces — any
real OrbitBTC app. Saves live only on the phone.

1. In GitHub: **Actions → "M7 build" → the latest run → Artifacts → `galactic-frontier-android-debug-apk`** (a zip; you must be signed in).
2. Unzip it. Check the file: `sha256sum galactic-frontier-m7-debug.apk` must equal the value in `galactic-frontier-m7-debug.apk.sha256`.
3. Get the APK onto the phone (USB, cloud drive, e-mail to yourself).
   - On the phone open the file. Android asks to allow "Install unknown apps" for the app you opened it from — allow it **for that app only**.
   - Or with a USB cable and `adb`: `adb install -r galactic-frontier-m7-debug.apk`.
4. Open **Galactic Frontier (test)**. It rotates to landscape and hides the system bars (swipe from an edge to reveal them).
5. Requirements: Android 7.0+ (API 24), a WebView that supports WebGL 2 (any recent Android System WebView / Chrome).

If Play Protect warns about an unknown app: this is an unsigned-by-store debug build; choose "Install anyway" only if you trust the
workflow run you downloaded it from.

## B. Browser build (no install)

Artifact `galactic-frontier-web-preview` contains one file, `index.html` (the whole game, offline).
Phones cannot open a zip artifact's HTML comfortably, so serve it from a computer on the same Wi-Fi:

```bash
cd <unzipped folder>
python3 -m http.server 8000
# on the phone (same network), Chrome: http://<computer-ip>:8000/index.html
```
Use Chrome, landscape, tap the fullscreen button when it appears. Add `?quality=basic|enhanced|ultra` to force a preset.

## Measuring performance on your device (important)

1. Start a game and open **Settings (gear) → Performance stats → on**. A pill with live FPS and a **Record** button appears at the top.
   (Shortcut: launch with `?perf=1` in the browser build, or `adb shell am start -n com.orbitbtc.galacticfrontier.standalone.debug/com.orbitbtc.galacticfrontier.MainActivity --ez perf true --es quality ultra`.)
2. Pick the preset to test in **Settings → Graphics** (Telegram Basic / PC Enhanced / Android Extreme HD). Leave *Adaptive resolution* on unless you want the raw cost.
3. Play the scenario you want to measure — for example, fly low over a planet for 60 s, or fight a pirate — then tap **Record**.
   Record **at least 60 seconds** (the report warns when it is too short). Let the phone run 5+ minutes to see thermal throttling in the 10-second windows.
4. Tap **Stop**. The card shows average FPS, **1 % low FPS**, frame-time percentiles, heap, resolution scale, graphics preset, GPU and device.
5. **Share…** (Android share sheet), **Copy JSON**, or **Save file** (the APK writes it to the app's files folder; pull with
   `adb pull /sdcard/Android/data/com.orbitbtc.galacticfrontier.standalone.debug/files/`). Send the JSON back with the phone model.

Record each preset separately, from the same scenario, with the battery above ~50 % and Battery Saver off.

### How to read a report
- `trustworthy: true` requires a real GPU renderer and ≥ 600 frames. If it is `false`, read `caveats`.
- `avgFps` can look fine while `low1PctFps` shows stutter — judge smoothness by the 1 % low and `slowFramesPct`.
- `windows[]` are 10-second slices: falling `avgFps` together with rising `thermal` (0 none … 6 shutdown) means thermal throttling.
- `renderScale` below 1 means the adaptive-resolution governor lowered the render resolution to hold the frame rate.

### Debugging on a computer (optional)
The debug APK enables WebView debugging: connect the phone by USB, open `chrome://inspect` in desktop Chrome, and inspect the game
page for the Performance and Memory panels. Release/web builds contain no test hooks (`window.__GF` does not exist).

## Known limitations of this test build
- Debug-signed, not for distribution; not available from any app store.
- No audio. Landscape only. One save slot (stored in the app's WebView storage; uninstalling deletes it).
- It was built and structurally verified (permissions, contents) in the cloud but **not run on an Android runtime** by its authors.
