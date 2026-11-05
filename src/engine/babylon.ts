/**
 * Single import surface for every Babylon.js feature the game uses.
 *
 * Deep (per-module) imports keep the bundle small enough for mobile WebViews and
 * Telegram Mini Apps. If a Babylon feature is needed elsewhere, add it here so
 * the side-effect registrations (scene components, shaders) stay in one place.
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
export { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
export { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
export { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
export { Camera } from "@babylonjs/core/Cameras/camera";
export { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
export { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
export type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
export { Material } from "@babylonjs/core/Materials/material";
export { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
export { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
export { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
export { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
export { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
export { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
export { SphericalHarmonics, SphericalPolynomial } from "@babylonjs/core/Maths/sphericalPolynomial";
export { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
export { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
export { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
export type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
export type { Observer } from "@babylonjs/core/Misc/observable";

// Side-effect registrations (scene components, mesh instancing, shadows, particles).
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Materials/Textures/baseTexture.polynomial";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Engines/Extensions/engine.query";

// M5 combat (append-only): procedural particle textures that also work under NullEngine.
export { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
