# Hero models (Full package only)

Drop authored glTF 2.0 / GLB models here and list them in `manifest.json`; `scripts/build.mjs` copies this folder to `models/` next to
`index.html` in the **Full** builds (preview, release, Android APK). It is never copied into the Telegram Lite build.

Rules for anything placed here:
* licence must permit redistribution inside a game (CC0, CC-BY with attribution, or a purchased commercial licence) — record it in the
  manifest entry and in `CREDITS.md`; **do not commit models with unclear or non-commercial licences**;
* skinned humanoid skeleton (Mixamo / Rigify / Reallusion CC / Biped style names are auto-mapped), PBR metallic-roughness materials;
* see `docs/ASSET-PIPELINE.md` for how to prepare, compress and size a model.

With no `manifest.json` (or no `astronaut` entry) the game uses the procedural astronaut, and says so in `window.__GF.state().astronaut`.
