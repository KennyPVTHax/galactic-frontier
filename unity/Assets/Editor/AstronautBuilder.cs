using System.Collections.Generic;
using System.IO;
using System.Linq;
using GF.Player;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>
    /// Builds the tnnv astronaut prefab from the Blender-retargeted FBX (scripts/premium/blender/retarget_astronaut.py):
    /// clip import settings, materials, animator state machine, jetpack exhaust, scale/facing normalisation.
    /// </summary>
    public static class AstronautBuilder
    {
        const string Dir = "Assets/Generated/Astronaut";
        const string Prefab = "Assets/Generated/Prefabs/Astronaut.prefab";
        static readonly string[] Loops = { "Idle", "Walk", "Run", "Sprint", "Fall", "IdleTorch", "Mine", "JetHover" };
        // natural foot speeds measured on the retargeted clips (clips.json), m/s at 1.0x playback
        const float WalkNat = 1.2f, RunNat = 2.96f, SprintNat = 3.79f;

        [MenuItem("Tools/Galactic Frontier/Build Astronaut")]
        public static GameObject Build()
        {
            string fbx = Dir + "/astronaut.fbx";
            if (!File.Exists(fbx)) { Debug.LogWarning("[GF] astronaut.fbx missing; run scripts/premium/blender/retarget_astronaut.py"); return null; }
            Directory.CreateDirectory("Assets/Generated/Prefabs");
            AssetDatabase.Refresh();
            AssetDatabase.ImportAsset(fbx, ImportAssetOptions.ForceUpdate);
            ConfigureImporter(fbx);

            var clips = AssetDatabase.LoadAllAssetsAtPath(fbx).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__")).ToDictionary(c => c.name, c => c);
            Debug.Log("[GF] astronaut clips: " + string.Join(", ", clips.Keys));
            var controller = BuildController(clips);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbx);
            var root = new GameObject("Astronaut");
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
            AssignMaterials(inst);

            // --- normalise: 1.8 m tall, feet on the ground, facing +Z
            var headB = inst.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.StartsWith("head_"));
            var feetB = inst.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.StartsWith("foot_l"));
            if (headB != null && feetB != null)
            {
                Vector3 upDir = headB.position - feetB.position;
                Debug.Log($"[GF] astronaut raw up vector {upDir.normalized}");
                inst.transform.rotation = Quaternion.FromToRotation(upDir, Vector3.up) * inst.transform.rotation;
            }
            var feet = inst.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.StartsWith("foot_l"));
            var ball = inst.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.StartsWith("ball_l"));
            if (feet != null && ball != null)
            {
                Vector3 d = ball.position - feet.position; d.y = 0;
                if (d.sqrMagnitude > 1e-6f) inst.transform.rotation = Quaternion.Euler(0, Vector3.SignedAngle(d, Vector3.forward, Vector3.up), 0) * inst.transform.rotation;
            }
            Bounds b = RenderBounds(inst);
            Debug.Log($"[GF] astronaut raw bounds size {b.size} center {b.center}");
            float s = 1.8f / b.size.y;
            inst.transform.localScale *= s;
            b = RenderBounds(inst);
            inst.transform.position += new Vector3(-b.center.x, -b.min.y, -b.center.z);
            b = RenderBounds(inst);
            Debug.Log($"[GF] astronaut normalised bounds size {b.size} min.y {b.min.y:F3}");

            var anim = inst.GetComponent<Animator>();
            if (anim == null) anim = inst.AddComponent<Animator>();
            anim.runtimeAnimatorController = controller;
            anim.applyRootMotion = false;
            anim.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            foreach (var smr in inst.GetComponentsInChildren<SkinnedMeshRenderer>()) { smr.updateWhenOffscreen = true; smr.quality = SkinQuality.Bone4; }

            var aa = inst.AddComponent<AstronautAnimator>();
            var jet = inst.AddComponent<JetpackFx>();
            jet.FlameMaterial = MakeParticleMaterial("Jet_Flame", true);
            jet.SmokeMaterial = MakeParticleMaterial("Jet_Smoke", false);
            var spine = inst.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.StartsWith("spine_03"));
            Transform mount = spine != null ? spine : inst.transform;
            jet.Build(mount, new[] { new Vector3(-0.13f, 1.02f, -0.30f), new Vector3(0.13f, 1.02f, -0.30f) });
            aa.Jet = jet;

            var saved = PrefabUtility.SaveAsPrefabAsset(root, Prefab);
            Object.DestroyImmediate(root);
            Debug.Log("[GF] astronaut prefab saved: " + Prefab);
            return saved;
        }

        static Bounds RenderBounds(GameObject go)
        {
            bool first = true; Bounds b = new Bounds();
            foreach (var r in go.GetComponentsInChildren<Renderer>())
            {
                if (r is ParticleSystemRenderer) continue;
                if (first) { b = r.bounds; first = false; } else b.Encapsulate(r.bounds);
            }
            return b;
        }

        static void ConfigureImporter(string fbx)
        {
            var mi = (ModelImporter)AssetImporter.GetAtPath(fbx);
            mi.animationType = ModelImporterAnimationType.Generic;
            mi.importAnimation = true;
            mi.materialImportMode = ModelImporterMaterialImportMode.None;
            mi.importTangents = ModelImporterTangents.CalculateMikk;
            mi.importNormals = ModelImporterNormals.Import;
            mi.meshCompression = ModelImporterMeshCompression.Off;
            mi.isReadable = false;
            mi.optimizeGameObjects = false;
            mi.animationCompression = ModelImporterAnimationCompression.Optimal;
            mi.SaveAndReimport();

            var list = new List<ModelImporterClipAnimation>();
            foreach (var c in mi.defaultClipAnimations)
            {
                string n = c.name.Contains("|") ? c.name.Substring(c.name.LastIndexOf('|') + 1) : c.name;
                if (n.StartsWith("Take") || n.StartsWith("__preview__")) continue;
                c.name = n;
                bool loop = Loops.Contains(n);
                c.loopTime = loop; c.loopPose = loop;
                c.lockRootRotation = false; c.lockRootHeightY = false; c.lockRootPositionXZ = false;
                list.Add(c);
            }
            mi.clipAnimations = list.ToArray();
            mi.SaveAndReimport();
        }

        static Texture2D Tex(string name) => AssetDatabase.LoadAssetAtPath<Texture2D>($"{Dir}/Textures/{name}.png");

        static Texture2D Solid(string name, Color c)
        {
            string path = $"Assets/Generated/{name}.asset";
            var t = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (t != null) return t;
            t = new Texture2D(4, 4, TextureFormat.RGBA32, false, true);
            var px = new Color[16]; for (int i = 0; i < 16; i++) px[i] = c;
            t.SetPixels(px); t.Apply();
            AssetDatabase.CreateAsset(t, path);
            return t;
        }

        static Material Mat(string name, Shader sh)
        {
            string path = $"Assets/Generated/{name}.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(sh); AssetDatabase.CreateAsset(m, path); } else m.shader = sh;
            return m;
        }

        static void AssignMaterials(GameObject inst)
        {
            var suitSh = Shader.Find("GF/Suit");
            var suit = Mat("Astro_Suit", suitSh);
            suit.SetTexture("_BaseMap", Tex("suit_base")); suit.SetTexture("_BumpMap", Tex("suit_nor")); suit.SetTexture("_MrMap", Tex("suit_mr"));
            var body = Mat("Astro_Body", suitSh);
            body.SetTexture("_BaseMap", Tex("body_base")); body.SetTexture("_MrMap", Solid("Flat_MR", new Color(0, 0.8f, 0, 1)));
            var helmet = Mat("Astro_Helmet", suitSh);
            helmet.SetTexture("_BaseMap", Tex("helmet_base")); helmet.SetTexture("_BumpMap", Tex("helmet_nor")); helmet.SetTexture("_MrMap", Tex("helmet_mr"));
            var glass = Mat("Astro_Glass", Shader.Find("Universal Render Pipeline/Lit"));
            glass.SetFloat("_Surface", 1); glass.SetFloat("_Blend", 0);
            glass.SetFloat("_SrcBlend", 5); glass.SetFloat("_DstBlend", 10); glass.SetFloat("_ZWrite", 0);
            glass.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); glass.renderQueue = 3000;
            glass.SetOverrideTag("RenderType", "Transparent");
            glass.SetColor("_BaseColor", new Color(0.32f, 0.5f, 0.62f, 0.42f)); glass.SetFloat("_Smoothness", 0.96f); glass.SetFloat("_Metallic", 0.15f);
            foreach (var m in new[] { suit, body, helmet, glass }) EditorUtility.SetDirty(m);

            foreach (var r in inst.GetComponentsInChildren<Renderer>(true))
            {
                Material m = r.name.Contains("Glass") ? glass : r.name.Contains("Helmet") ? helmet : r.name.Contains("Body") ? body : r.name.Contains("Spacesuit") ? suit : null;
                if (m == null) continue;
                var arr = new Material[Mathf.Max(1, r.sharedMaterials.Length)];
                for (int i = 0; i < arr.Length; i++) arr[i] = m;
                r.sharedMaterials = arr;
                r.shadowCastingMode = r.name.Contains("Glass") ? UnityEngine.Rendering.ShadowCastingMode.Off : UnityEngine.Rendering.ShadowCastingMode.On;
            }
        }

        static Material MakeParticleMaterial(string name, bool additive)
        {
            var m = Mat(name, Shader.Find("GF/Particle"));
            m.SetFloat("_Additive", additive ? 1 : 0);
            m.SetFloat("_DstBlend", additive ? 1 : 10);          // One / OneMinusSrcAlpha
            m.SetFloat("_Softness", additive ? 0.5f : 1.0f);
            m.SetFloat("_Core", additive ? 0.65f : 0f);
            m.renderQueue = 3010;
            EditorUtility.SetDirty(m);
            return m;
        }

        // ------------------------------------------------------------------ animator state machine
        static AnimatorController BuildController(Dictionary<string, AnimationClip> c)
        {
            string path = "Assets/Generated/Astronaut.controller";
            AssetDatabase.DeleteAsset(path);
            var ctrl = AnimatorController.CreateAnimatorControllerAtPath(path);
            ctrl.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ctrl.AddParameter("VelY", AnimatorControllerParameterType.Float);
            ctrl.AddParameter("Grounded", AnimatorControllerParameterType.Bool);
            ctrl.AddParameter("Jet", AnimatorControllerParameterType.Bool);
            ctrl.AddParameter("Mine", AnimatorControllerParameterType.Bool);
            ctrl.AddParameter("Jump", AnimatorControllerParameterType.Trigger);
            var sm = ctrl.layers[0].stateMachine;

            // locomotion blend tree on gameplay speed (m/s). Playback is scaled so feet match the ground speed.
            var loco = ctrl.CreateBlendTreeInController("Locomotion", out BlendTree tree);
            tree.blendParameter = "Speed"; tree.blendType = BlendTreeType.Simple1D; tree.useAutomaticThresholds = false;
            tree.AddChild(c["Idle"], 0f);
            tree.AddChild(c["Walk"], 1.6f);
            tree.AddChild(c["Run"], 3.4f);
            tree.AddChild(c["Sprint"], 5.5f);
            tree.AddChild(c["Sprint"], 10f);
            var ch = tree.children;
            ch[0].timeScale = 1f;
            ch[1].timeScale = 1.6f / WalkNat;                    // 1.33
            ch[2].timeScale = 3.4f / RunNat;                     // 1.15
            ch[3].timeScale = 5.5f / SprintNat;                  // 1.45
            ch[4].timeScale = Mathf.Min(10f / SprintNat, 1.85f); // capped: faster cadence would look frantic
            tree.children = ch;
            sm.defaultState = loco;

            AnimatorState St(string n, AnimationClip clip, float speed = 1f) { var s = sm.AddState(n); s.motion = clip; s.speed = speed; return s; }
            var jump = St("JumpStart", c["JumpStart"], 1.5f);
            var fall = St("Fall", c["Fall"]);
            var land = St("Land", c["Land"], 1.4f);
            var jetS = St("JetHover", c["Fall"], 0.55f);   // upright, limbs hanging; the NinjaJump clip looked like kneeling
            var mine = St("Mine", c["Mine"], 1.0f);

            AnimatorStateTransition T(AnimatorState from, AnimatorState to, float dur, bool exit = false, float exitTime = 0.9f)
            {
                var t = from.AddTransition(to); t.hasExitTime = exit; t.exitTime = exitTime; t.duration = dur; t.hasFixedDuration = true; t.canTransitionToSelf = false; return t;
            }

            var t1 = sm.AddAnyStateTransition(jump); t1.hasExitTime = false; t1.duration = 0.08f; t1.canTransitionToSelf = false; t1.AddCondition(AnimatorConditionMode.If, 0, "Jump");

            var j2f = T(jump, fall, 0.15f, true, 0.75f); j2f.AddCondition(AnimatorConditionMode.IfNot, 0, "Jet");
            var j2j = T(jump, jetS, 0.15f); j2j.AddCondition(AnimatorConditionMode.If, 0, "Jet");
            var l2f = T(loco, fall, 0.2f); l2f.AddCondition(AnimatorConditionMode.IfNot, 0, "Grounded");
            var f2j = T(fall, jetS, 0.18f); f2j.AddCondition(AnimatorConditionMode.If, 0, "Jet");
            var j2fl = T(jetS, fall, 0.25f); j2fl.AddCondition(AnimatorConditionMode.IfNot, 0, "Jet"); j2fl.AddCondition(AnimatorConditionMode.IfNot, 0, "Grounded");
            foreach (var air in new[] { fall, jetS, jump })
            {
                var a2l = T(air, land, 0.08f); a2l.AddCondition(AnimatorConditionMode.If, 0, "Grounded");
            }
            var land2loco = T(land, loco, 0.2f, true, 0.5f);
            var lm = T(loco, mine, 0.15f); lm.AddCondition(AnimatorConditionMode.If, 0, "Mine"); lm.AddCondition(AnimatorConditionMode.Less, 1.0f, "Speed");
            var ml = T(mine, loco, 0.2f); ml.AddCondition(AnimatorConditionMode.IfNot, 0, "Mine");
            var ml2 = T(mine, loco, 0.2f); ml2.AddCondition(AnimatorConditionMode.Greater, 1.5f, "Speed");
            var mf = T(mine, fall, 0.2f); mf.AddCondition(AnimatorConditionMode.IfNot, 0, "Grounded");
            EditorUtility.SetDirty(ctrl);
            return ctrl;
        }
    }
}
