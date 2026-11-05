/**
 * Babylon.js facade for the Galactic Frontier LITE package (Telegram Mini App).
 *
 * scripts/build.mjs (`telegram` mode) redirects every `engine/babylon` import here. It re-exports exactly the features the
 * Lite presentation uses and REPLACES the heavyweight ones with inert stubs, so their code and shader sources never enter the
 * Telegram bundle:
 *   PBR materials, the post-process pipeline (bloom/MSAA/tone-curves), shadow generators (single + cascaded), reflection probes,
 *   render-target textures, spherical-harmonic environment lighting, custom post processes, colour curves.
 * Lite always runs the `basic` render profile (see src/graphics/profiles.ts `LITE_TIER_CEILING`), which never constructs them.
 * A stub constructor throws loudly instead of silently misrendering, so a regression that reaches for a Full-only feature
 * fails in tests (tests/package-boundary.test.ts) rather than on a player's phone.
 *
 * Only presentation is reduced. Gameplay (src/gameplay, combat simulation, universe, saves, sync) is the same code in both packages.
 */
export { Engine } from "@babylonjs/core/Engines/engine";
export { Scene } from "@babylonjs/core/scene";
export { Vector3, Vector4, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
export { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
export { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
export { Effect } from "@babylonjs/core/Materials/effect";
export { Texture } from "@babylonjs/core/Materials/Textures/texture";
export { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
export { PointLight } from "@babylonjs/core/Lights/pointLight";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
export { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
export { Camera } from "@babylonjs/core/Cameras/camera";
export { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
export { Material } from "@babylonjs/core/Materials/material";
export { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
export { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
export { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
export { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
export { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
export { Constants } from "@babylonjs/core/Engines/constants";

// Side-effect registrations Lite still needs (particles, thin instances, picking rays, GPU queries).
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Engines/Extensions/engine.query";

/** Marker so tests and logs can tell the facade apart from the full one. */
export const LITE_FACADE = true;

function fullOnly(name: string): never {
  throw new Error(`${name} is a Full-package feature and is not included in Galactic Frontier Lite`);
}

// ---- Full-only features: inert stubs (never constructed on the `basic` profile) -----------------------------------------
export class PBRMaterial { constructor(..._a: unknown[]) { fullOnly("PBRMaterial"); } }
export class ShadowGenerator {
  static readonly QUALITY_LOW = 2;
  static readonly QUALITY_MEDIUM = 1;
  static readonly QUALITY_HIGH = 0;
  constructor(..._a: unknown[]) { fullOnly("ShadowGenerator"); }
}
export class CascadedShadowGenerator { constructor(..._a: unknown[]) { fullOnly("CascadedShadowGenerator"); } }
export class ReflectionProbe { constructor(..._a: unknown[]) { fullOnly("ReflectionProbe"); } }
export class RenderTargetTexture {
  static readonly REFRESHRATE_RENDER_ONCE = 0;
  constructor(..._a: unknown[]) { fullOnly("RenderTargetTexture"); }
}
export class DefaultRenderingPipeline { constructor(..._a: unknown[]) { fullOnly("DefaultRenderingPipeline"); } }
export class PostProcess { constructor(..._a: unknown[]) { fullOnly("PostProcess"); } }
export class ColorCurves { constructor() { fullOnly("ColorCurves"); } }
export class SphericalHarmonics { constructor() { fullOnly("SphericalHarmonics"); } }
export class SphericalPolynomial {
  static FromHarmonics(..._a: unknown[]): never { return fullOnly("SphericalPolynomial"); }
}
