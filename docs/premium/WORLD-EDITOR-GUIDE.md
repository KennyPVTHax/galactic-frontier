# Galactic Frontier World Editor — beginner's guide

You do not need to write any code. Everything below is mouse clicks inside Unity.

## 0. One-time setup (already done on this PC)
If the editor says *"planet materials haven't been generated yet"*, click **Tools ▸ Galactic Frontier ▸ Build Planet Scene** once and wait for it to finish (a couple of minutes). Then you never need to do it again.

## 1. Open the editor
1. In Unity's top menu click **Tools ▸ Galactic Frontier ▸ World Editor**. A window called **GF World Editor** opens (dock it next to the Scene view if you like).
2. Make sure a **Scene** tab is visible (Window ▸ General ▸ Scene if not).
3. In the World Editor window click **Open planet**. The planet Aetherion appears in the Scene view. Nothing is added to your Unity scene; the planet is a temporary preview.

## 2. Move around
* In the **Scene view**: hold the **right mouse button** and press **W A S D** to fly, **Q / E** down / up, scroll wheel to zoom, **Alt + left-drag** to orbit.
* In the World Editor window, **Navigate** tab:
  * **Whole planet** – zoom out to see the globe.
  * **Landing site** – jump to the Aetherion landing area.
  * **Here → surface** – point your mouse at any spot on the planet in the Scene view, then click this to fly down to it.
  * **Level the view with the planet** – if the horizon is tilted, click this.
  * **Show terrain patch boundaries** – draws the coloured squares that Unity streams in and out (useful for understanding; leave it off normally).
* Tip: the editing tools only draw grass and props when you are within about 90 m of the ground. Fly down to see them.

## 3. Make a region (optional but handy)
Regions are named areas. They give you a "Go" button and an optional safety limit.
1. Point the Scene view camera at the ground where you want to work.
2. **Navigate** tab → **New region at the Scene view centre**. A yellow ring appears.
3. Type a name, drag the radius slider, tick **Only edit inside this region** if you want a safety fence.

## 4. Sculpt the ground  (tab: **Sculpt**)
1. Click **Raise**, **Lower**, **Smooth** or **Flatten**.
2. Set **Brush size** (metres) and **Brush strength**.
3. **Left-click and drag on the terrain.** A white circle shows the brush.
   * **Ctrl** held = flips Raise ↔ Lower.  **Shift** held = smooth.
   * **Flatten** levels the ground to the height where you started dragging (great for building pads).
4. Everything you do is an *offset* on top of the generated planet, so it survives if the generated planet is regenerated.

## 5. Paint the ground  (tab: **Paint**)
1. Click **Grass**, **Dirt**, **Rock** or **Sand**.
2. Left-drag on the terrain. **Erase paint** hands the area back to the automatic materials.

## 6. Add rocks  (tab: **Props**)
1. Choose a rock in **Prop to place** (boulders, a cliff outcrop, pebbles).
2. **Left-click the ground** to place one (random size/rotation within the slider range).
3. **Click a rock** to select it. Drag the arrows to move it; drag the circle to turn it; use the **Size** and **Rotation** sliders; **Delete** key (or *Delete selected*) removes it.
4. Tick **Mark as handcrafted landmark** for rocks the game must never move or replace.

## 7. Grass and "keep clear" zones  (tab: **Vegetation**)
* **Paint grass** – left-drag to grow a meadow (density slider).
* **Keep clear (exclude)** – left-drag to make sure no automatic vegetation ever spawns there (for paths, building yards, landing pads).
* **Erase** – removes your grass paint/exclusion and returns the area to the automatic rules.

## 8. Undo, save, reload
* **Ctrl+Z / Ctrl+Y** undo and redo every brush stroke, rock placement, move and delete.
* **Save changes** (top of the window) writes your world to `Assets/Resources/Authored/aetherion.gfworld.bytes` (plus a readable `Assets/GameData/aetherion.authored.summary.txt`). The button turns amber with a * when there is unsaved work. Tick **Auto-save** if you prefer.
* **Reload from disk** throws away unsaved changes and shows exactly what a restart would load.
* Commit those files with Git to keep your work safe: `git add unity/Assets/Resources/Authored unity/Assets/GameData && git commit`.

## 9. Play what you made
* **Navigate ▸ Play here in Unity** – saves, opens the planet scene and starts the game at the spot your mouse was on.
* **Navigate ▸ Build Windows preview** – builds and launches a standalone Windows version (`unity/Builds/WinPlanet/GalacticFrontierPlanet.exe`).
* In game: **WASD** move, **mouse** look (click to capture), **Space** jump / hold for jetpack, **Shift** run, **Esc** release the mouse.

## 10. The demo region
A starter area, **Demo Meadow**, is already saved next to the landing site: a knoll with a levelled lookout pad, a dry stream bed, painted rock/sand/dirt, a meadow, a cleared yard and 12 rocks (one marked as a landmark). Open the editor, **Navigate ▸ Go** next to *Demo Meadow*, and change anything. Delete it by erasing/removing things, or start your own region elsewhere.

## What is saved where
| Layer | Where | Changes when… |
|---|---|---|
| Procedural planet (mountains, seas, base ground) | generated from the seed in code | never edited by hand; the seed or generator code changes |
| **Your terrain, paint, grass paint/exclusion** | `aetherion.gfworld.bytes` (sparse height offsets on a fixed grid) | you sculpt/paint |
| **Your rocks, landmarks, regions** | same file | you place/move/delete |
| Procedural vegetation (automatic grass) | recreated deterministically at runtime, never saved | rules or your paint/exclusion change |

## If something looks wrong
* *Nothing happens when I drag* – make sure a tool tab (not Navigate) is selected and the mouse is over the planet (the white brush circle should show).
* *No grass or rocks visible* – fly lower than ~90 m above the ground.
* *Unity asks about In-App Purchasing / Package Manager* – harmless; close the window.
* *I made a mistake* – Ctrl+Z, or **Reload from disk** to go back to your last save.

## Limitations (see CHECKPOINT-3.md)
Only Aetherion is editable. Painting resolution is about 0.5 m. Flatten is stored as an offset, so if the procedural terrain underneath is regenerated the flattened area follows the new ground rather than staying at the old absolute height. Vegetation is one grass type; trees and bushes come in Checkpoint 4.
