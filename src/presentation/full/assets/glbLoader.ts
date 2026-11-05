/**
 * GLB / glTF 2.0 asset pipeline (Full package only).
 *
 * - Loads authored, PBR, skinned glTF 2.0 / GLB models with Babylon's official loader, registered through its tree-shakeable `.pure`
 *   entry points (only the extensions below enter the bundle).
 * - Fully OFFLINE: everything is fetched from the app's own origin (`models/…` inside the APK / web build). The compressed-geometry /
 *   compressed-texture extensions are registered ONLY when their decoder files are shipped and configured, because Babylon would
 *   otherwise fall back to a CDN download, which an offline APK must never do. A model that needs an unsupported extension simply
 *   fails to load and the caller falls back.
 * - Never throws into gameplay: `loadModel` resolves with an error description instead of rejecting, with a hard timeout.
 * - Not part of the Lite package (see src/presentation/astronaut.lite.ts).
 */
import type { Scene, TransformNode, AbstractMesh } from "../../../engine/babylon";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { RegisterGLTFFileLoader } from "@babylonjs/loaders/glTF/glTFFileLoader.pure";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure";
import { RegisterKHR_texture_transform } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.pure";
import { RegisterKHR_mesh_quantization } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.pure";
import { RegisterKHR_materials_emissive_strength } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength.pure";
import { RegisterEXT_texture_webp } from "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.pure";
import { RegisterKHR_draco_mesh_compression } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_draco_mesh_compression.pure";
import { RegisterKHR_texture_basisu } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_basisu.pure";
import { DracoCompression } from "@babylonjs/core/Meshes/Compression/dracoCompression";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";

export interface DecoderConfig {
  /** URLs of the Draco decoder (wasm + js glue + js fallback) shipped inside the app. */
  draco?: { wasmUrl: string; wasmBinaryUrl: string; fallbackUrl: string };
  /** URL of the KTX2 transcoder config shipped inside the app (see Babylon `KhronosTextureContainer2.URLConfig`). */
  ktx2?: { jsDecoderModule: string; wasmUASTCToASTC: string; wasmUASTCToBC7: string; wasmUASTCToRGBA_UNORM: string; wasmUASTCToRGBA_SRGB: string; wasmUASTCToR8_UNORM: string; wasmUASTCToRG8_UNORM: string; jsMSCTranscoder: string; wasmMSCTranscoder: string; wasmZSTDDecoder: string };
}

let registered = false;
/** Registers the glTF 2.0 loader and the (offline-safe) extension set once. Idempotent. */
export function registerGlbSupport(decoders: DecoderConfig = {}): string[] {
  const exts = ["KHR_texture_transform", "KHR_mesh_quantization", "KHR_materials_emissive_strength", "EXT_texture_webp"];
  if (!registered) {
    RegisterGLTFFileLoader();
    RegisterGLTF2Loader();
    RegisterKHR_texture_transform();
    RegisterKHR_mesh_quantization();
    RegisterKHR_materials_emissive_strength();
    // WebP is decoded by the browser / Android WebView itself: no extra files, no network.
    RegisterEXT_texture_webp();
    registered = true;
  }
  if (decoders.draco) {
    DracoCompression.Configuration = { decoder: decoders.draco };
    RegisterKHR_draco_mesh_compression();
    exts.push("KHR_draco_mesh_compression");
  }
  if (decoders.ktx2) {
    (KhronosTextureContainer2 as unknown as { URLConfig: unknown }).URLConfig = decoders.ktx2;
    RegisterKHR_texture_basisu();
    exts.push("KHR_texture_basisu");
  }
  return exts;
}

export interface LoadedModel {
  url: string;
  container: AssetContainer;
  meshes: AbstractMesh[];
  nodes: TransformNode[];
  skeletons: Skeleton[];
  clips: AnimationGroup[];
  /** Wall-clock load time in ms. */
  loadMs: number;
}
export type LoadResult = { ok: true; model: LoadedModel } | { ok: false; reason: string };

/** Loads one GLB. Resolves (never rejects) and gives up after `timeoutMs`. The container is NOT yet added to the scene. */
export async function loadModel(scene: Scene, url: string, timeoutMs = 20000): Promise<LoadResult> {
  const t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const load = LoadAssetContainerAsync(url, scene, { pluginExtension: ".glb" });
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)));
    const container = (await Promise.race([load, timeout])) as AssetContainer;
    const nodes = container.transformNodes.slice();
    for (const m of container.meshes) if (!nodes.includes(m as unknown as TransformNode)) nodes.push(m as unknown as TransformNode);
    for (const g of container.animationGroups) g.stop();
    return { ok: true, model: { url, container, meshes: container.meshes, nodes, skeletons: container.skeletons, clips: container.animationGroups, loadMs: Math.round(performance.now() - t0) } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fetches and parses `models/manifest.json` next to the page. Resolves null when absent (the normal case when no hero asset is shipped). */
export interface AssetManifest {
  version: 1;
  assets: Record<string, AssetEntry>;
  /** Optional decoder files shipped with the app (relative to the manifest). */
  decoders?: DecoderConfig;
}
export interface AssetEntry {
  /** GLB per graphics tier; the highest available at or below the active tier is used. */
  variants: Partial<Record<"enhanced" | "ultra", string>>;
  /** Normalisation: model height in metres after scaling (default 1.8) and yaw (radians) to make it face +Z in game space. */
  height?: number;
  yaw?: number;
  /** Required attribution / licence record shown in credits. */
  license: { name: string; url: string; author: string; source: string; title: string };
}

export async function fetchManifest(base: string, timeoutMs = 4000): Promise<{ manifest: AssetManifest; base: string } | null> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const r = await fetch(new URL("manifest.json", base).toString(), { signal: ctl?.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as AssetManifest;
    if (j?.version !== 1 || typeof j.assets !== "object") return null;
    return { manifest: j, base };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
