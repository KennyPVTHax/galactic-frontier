using System;
using System.Collections.Generic;
using GF.Planet;
using UnityEngine;

namespace GF.Authoring
{
    /// <summary>Marks a spawned prop instance with its stable id so editor tools can map it back to the authored data.</summary>
    public sealed class PlacedPropMarker : MonoBehaviour { public string Id; }

    /// <summary>
    /// Spawns authored props near the viewer and removes them when far away. Instances are derived from the authored data
    /// (surface-snapped on the analytic planet, aligned to the local normal), so they are independent of terrain patch
    /// rebuilds and a prop that streams out and back in is recreated identically, never duplicated.
    /// </summary>
    public sealed class PropStreamer : MonoBehaviour
    {
        public AuthoredWorld World;
        public IPlanetField Field;
        public double Radius;
        public float SpawnRange = 380f, DespawnRange = 480f, Interval = 0.25f;
        public Dictionary<string, GameObject> Library = new Dictionary<string, GameObject>();
        public HideFlags ObjectFlags = HideFlags.None;

        readonly Dictionary<string, (GameObject go, int rev)> live = new Dictionary<string, (GameObject, int)>();
        readonly Dictionary<string, int> propRev = new Dictionary<string, int>();
        float timer;
        public int LiveCount => live.Count;
        public int TotalSpawned { get; private set; }
        public int TotalDespawned { get; private set; }
        public IEnumerable<KeyValuePair<string, (GameObject go, int rev)>> Live => live;
        public bool TryGetLive(string id, out GameObject go) { if (live.TryGetValue(id, out var e) && e.go != null) { go = e.go; return true; } go = null; return false; }

        static void Kill(UnityEngine.Object o) { if (o == null) return; if (Application.isPlaying) Destroy(o); else DestroyImmediate(o); }

        void Update() { if (Application.isPlaying) { timer -= Time.deltaTime; if (timer <= 0) { timer = Interval; if (Camera.main != null) Tick(Camera.main.transform.position); } } }

        /// <summary>Marks one prop as changed so it is respawned with its new transform on the next tick.</summary>
        public void Refresh(string id) { if (live.TryGetValue(id, out var e)) { Kill(e.go); live.Remove(id); TotalDespawned++; } }

        public void ClearAll() { foreach (var e in live.Values) Kill(e.go); live.Clear(); }

        public Vector3 SurfacePoint(PlacedProp p, out Quaternion rot)
        {
            Vec3d d = p.Dir.Normalized;
            double h = Field.Height(d);
            Vec3d n = PatchMesher.StencilNormal(Field, Radius, d, 0.6 / Radius);
            double r = Radius + h - p.sink * p.scale;
            Vector3 up = new Vector3((float)n.x, (float)n.y, (float)n.z);
            rot = Quaternion.FromToRotation(Vector3.up, up) * Quaternion.AngleAxis(p.yaw, Vector3.up);
            return new Vector3((float)(d.x * r), (float)(d.y * r), (float)(d.z * r));
        }

        public void Tick(Vector3 viewer)
        {
            if (World == null || Field == null) return;
            var gone = new List<string>();
            foreach (var kv in live)
            {
                var prop = World.FindProp(kv.Key);
                if (prop == null || kv.Value.go == null) { gone.Add(kv.Key); continue; }
                Vector3 p = new Vector3((float)(prop.x * Radius), (float)(prop.y * Radius), (float)(prop.z * Radius));
                if ((p - viewer).magnitude > DespawnRange) gone.Add(kv.Key);
            }
            foreach (var id in gone) { Kill(live[id].go); live.Remove(id); TotalDespawned++; }

            foreach (var prop in World.Props)
            {
                if (live.ContainsKey(prop.id)) continue;
                Vector3 approx = new Vector3((float)(prop.x * Radius), (float)(prop.y * Radius), (float)(prop.z * Radius));
                if ((approx - viewer).magnitude > SpawnRange) continue;
                if (!Library.TryGetValue(prop.kind, out var prefab) || prefab == null) continue;
                Vector3 pos = SurfacePoint(prop, out var rot);
                var go = Instantiate(prefab, pos, rot, transform);
                go.name = prop.kind + "_" + prop.id; go.transform.localScale = Vector3.one * prop.scale;
                go.hideFlags = ObjectFlags;
                foreach (var t in go.GetComponentsInChildren<Transform>()) t.gameObject.hideFlags = ObjectFlags;
                go.AddComponent<PlacedPropMarker>().Id = prop.id;
                live[prop.id] = (go, 0); TotalSpawned++;
            }
        }
    }
}
