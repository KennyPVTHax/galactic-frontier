using UnityEngine;
using UnityEngine.Rendering;

namespace GF.Player
{
    /// <summary>
    /// Jetpack exhaust built from soft, depth-faded particles (no solid flame geometry): a hot core plume per nozzle,
    /// a slower turbulent smoke trail, heat shimmer-free but with a flickering point light. Thrust ramps smoothly,
    /// so ignition and cut-off fade instead of popping. World-space simulation leaves a trail when moving.
    /// </summary>
    public sealed class JetpackFx : MonoBehaviour
    {
        public Material FlameMaterial, SmokeMaterial;
        public Transform[] Nozzles;
        public float Ramp = 9f;

        [SerializeField] ParticleSystem[] flames, smokes;
        [SerializeField] Light glow;
        float thrust, target;
        float seed;

        public void Build(Transform parent, Vector3[] worldNozzlePositions)
        {
            Nozzles = new Transform[worldNozzlePositions.Length];
            flames = new ParticleSystem[Nozzles.Length];
            smokes = new ParticleSystem[Nozzles.Length];
            for (int i = 0; i < Nozzles.Length; i++)
            {
                var go = new GameObject("Nozzle" + i);
                go.transform.SetParent(parent, true);
                go.transform.position = worldNozzlePositions[i];
                go.transform.rotation = Quaternion.LookRotation(Vector3.down, Vector3.forward);   // emit downward
                Nozzles[i] = go.transform;
                flames[i] = MakeFlame(go.transform);
                smokes[i] = MakeSmoke(go.transform);
            }
            var lg = new GameObject("JetGlow"); lg.transform.SetParent(parent, true);
            lg.transform.position = (worldNozzlePositions[0] + worldNozzlePositions[worldNozzlePositions.Length - 1]) * 0.5f + Vector3.down * 0.35f;
            glow = lg.AddComponent<Light>();
            glow.type = LightType.Point; glow.color = new Color(1f, 0.62f, 0.28f); glow.range = 5.5f; glow.intensity = 0f; glow.shadows = LightShadows.None;
            seed = Random.value * 100f;
        }

        public void SetThrust(float t) => target = Mathf.Clamp01(t);

        ParticleSystem MakeFlame(Transform p)
        {
            var go = new GameObject("Flame"); go.transform.SetParent(p, false);
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.loop = true; main.playOnAwake = true; main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.14f, 0.26f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(2.8f, 4.5f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.14f, 0.24f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
            main.startColor = new ParticleSystem.MinMaxGradient(new Color(1f, 0.95f, 0.75f, 1f), new Color(1f, 0.7f, 0.35f, 1f));
            main.maxParticles = 400;
            var em = ps.emission; em.rateOverTime = 0;
            var sh = ps.shape; sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 3f; sh.radius = 0.03f;
            var col = ps.colorOverLifetime; col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(new Color(1f, 0.97f, 0.85f), 0f), new GradientColorKey(new Color(1f, 0.55f, 0.18f), 0.35f), new GradientColorKey(new Color(0.35f, 0.18f, 0.25f), 1f) },
                      new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.95f, 0.08f), new GradientAlphaKey(0.45f, 0.55f), new GradientAlphaKey(0f, 1f) });
            col.color = g;
            var size = ps.sizeOverLifetime; size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0f, 0.55f), new Keyframe(0.25f, 1f), new Keyframe(1f, 1.9f)));
            var noise = ps.noise; noise.enabled = true; noise.strength = 0.55f; noise.frequency = 2.2f; noise.scrollSpeed = 1.4f; noise.quality = ParticleSystemNoiseQuality.Medium;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = FlameMaterial; r.renderMode = ParticleSystemRenderMode.Stretch; r.velocityScale = 0.05f; r.lengthScale = 2.2f; r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            return ps;
        }

        ParticleSystem MakeSmoke(Transform p)
        {
            var go = new GameObject("Smoke"); go.transform.SetParent(p, false);
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.loop = true; main.playOnAwake = true; main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.9f, 1.6f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(1.0f, 2.4f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.18f, 0.34f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f);
            main.startColor = new Color(0.62f, 0.64f, 0.7f, 0.5f);
            main.gravityModifier = -0.04f;
            main.maxParticles = 140;
            var em = ps.emission; em.rateOverTime = 0;
            var sh = ps.shape; sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 12f; sh.radius = 0.04f;
            var col = ps.colorOverLifetime; col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(new Color(0.9f, 0.8f, 0.7f), 0f), new GradientColorKey(new Color(0.55f, 0.57f, 0.63f), 0.3f), new GradientColorKey(new Color(0.5f, 0.52f, 0.58f), 1f) },
                      new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.4f, 0.12f), new GradientAlphaKey(0.18f, 0.6f), new GradientAlphaKey(0f, 1f) });
            col.color = g;
            var size = ps.sizeOverLifetime; size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0f, 0.5f), new Keyframe(1f, 3.2f)));
            var noise = ps.noise; noise.enabled = true; noise.strength = 0.9f; noise.frequency = 0.9f; noise.scrollSpeed = 0.6f; noise.quality = ParticleSystemNoiseQuality.Medium;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = SmokeMaterial; r.renderMode = ParticleSystemRenderMode.Billboard; r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            return ps;
        }

        void Update()
        {
            if (flames == null) return;
            thrust = Mathf.MoveTowards(thrust, target, Time.deltaTime * Ramp * (target > thrust ? 1f : 0.7f));
            float flick = 0.85f + 0.15f * Mathf.PerlinNoise(Time.time * 23f, seed);
            for (int i = 0; i < flames.Length; i++)
            {
                var fe = flames[i].emission; fe.rateOverTime = 520f * thrust * thrust;
                var m = flames[i].main; m.startSpeed = new ParticleSystem.MinMaxCurve(2.8f * (0.55f + thrust * 0.6f), 4.5f * (0.55f + thrust * 0.6f));
                var se = smokes[i].emission; se.rateOverTime = 38f * thrust;
            }
            if (glow != null) glow.intensity = 3.2f * thrust * flick;
        }
    }
}
