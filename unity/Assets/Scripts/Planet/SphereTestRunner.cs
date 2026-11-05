using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GF.Player;
using UnityEngine;

namespace GF.Planet
{
    /// <summary>
    /// Automated evidence for the planet checkpoint (player launched with  -gfplanet &lt;dir&gt;):
    ///  * globe overview shots from space,
    ///  * walks across cube-face edges, a corner, both poles, the authored region and the antipode, measuring that the
    ///    player always stays on the analytic surface AND never sinks below the *rendered* mesh,
    ///  * a fast fly-over to exercise streaming (build/release counts, mesh memory, frame times).
    /// Writes planet_tests.json and screenshots, then quits.
    /// </summary>
    public sealed class SphereTestRunner : MonoBehaviour
    {
        public static bool Active;
        string dir; PlanetBootstrap boot;
        readonly StringBuilder json = new StringBuilder();
        bool firstEntry = true;

        void Awake()
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, "-gfplanet");
            if (i < 0 || i + 1 >= args.Length) { enabled = false; return; }
            dir = args[i + 1]; Directory.CreateDirectory(dir); Active = true;
            boot = GetComponent<PlanetBootstrap>();
        }

        void Add(string key, string value) { if (!firstEntry) json.Append(",\n"); firstEntry = false; json.Append("  \"" + key + "\": " + value); }
        IEnumerator Shot(string n) { yield return new WaitForEndOfFrame(); ScreenCapture.CaptureScreenshot(Path.Combine(dir, n + ".png")); yield return null; }
        static string F(double v) => double.IsNaN(v) || double.IsInfinity(v) ? "null" : v.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);

        static Vec3d Offset(Vec3d d, Vector3 heading, double meters, double R)
        {
            double th = meters / R; Vec3d h = new Vec3d(heading.x, heading.y, heading.z).Normalized;
            return (d * Math.Cos(th) + h * Math.Sin(th)).Normalized;
        }

        IEnumerator Start()
        {
            if (!enabled) yield break;
            json.Append("{\n");
            while (!boot.Ready) yield return null;
            for (int f = 0; f < 60; f++) yield return null;
            var cam = Camera.main; var rig = boot.Rig; var tree = boot.Tree; var player = boot.Player; double R = boot.PlanetRadius;
            Add("gpu", "\"" + SystemInfo.graphicsDeviceName + "\"");
            Add("radiusM", F(R));

            // ---------- surface at the landing site
            yield return Shot("00_landing");

            // ---------- globe overview from space
            rig.FreeOrbit = true; player.gameObject.SetActive(true);
            var views = new (string name, Vector3 dirV)[] { ("10_globe_anchor", boot.AnchorDirection), ("11_globe_pole", Vector3.up), ("12_globe_corner", new Vector3(-1, -1, 1)), ("13_globe_antipode", -boot.AnchorDirection) };
            foreach (var v in views)
            {
                Vector3 n = v.dirV.normalized;
                cam.transform.position = n * (float)(R * 3.3);
                cam.transform.rotation = Quaternion.LookRotation(-n, Mathf.Abs(n.y) > 0.9f ? Vector3.forward : Vector3.up);
                for (int f = 0; f < 45; f++) yield return null;
                Add(v.name + "_patches", tree.ActiveCount.ToString());
                yield return Shot(v.name);
            }
            // low orbit
            {
                Vector3 n = boot.AnchorDirection.normalized;
                cam.transform.position = n * (float)(R + 900); cam.transform.rotation = Quaternion.LookRotation(Vector3.Cross(n, Vector3.up).normalized * 0.6f - n, n);
                for (int f = 0; f < 60; f++) yield return null;
                yield return Shot("14_low_orbit");
            }
            rig.FreeOrbit = false;

            // ---------- walks across boundaries
            var anchor = boot.Anchor;
            Vec3d aDir = new Vec3d(boot.AnchorDirection.x, boot.AnchorDirection.y, boot.AnchorDirection.z).Normalized;
            var cases = new List<(string name, Vec3d start, Vector3 heading)>();
            Vec3d edge = new Vec3d(1, 0.3, 1).Normalized; Vector3 eUp = V(edge);
            cases.Add(("edge_+X_+Z", Offset(edge, SphericalPlayer.Tangent(new Vector3(-1, 0, 1), eUp), -90, R), SphericalPlayer.Tangent(new Vector3(-1, 0, 1), eUp)));
            Vec3d corner = new Vec3d(1, 1, 1).Normalized; Vector3 cUp = V(corner);
            cases.Add(("corner_+X+Y+Z", Offset(corner, SphericalPlayer.Tangent(new Vector3(-0.2f, -1f, 0.6f), cUp), -90, R), SphericalPlayer.Tangent(new Vector3(-0.2f, -1f, 0.6f), cUp)));
            Vec3d corner2 = new Vec3d(-1, -1, -1).Normalized; Vector3 c2Up = V(corner2);
            cases.Add(("corner_-X-Y-Z", Offset(corner2, SphericalPlayer.Tangent(new Vector3(1f, 0.3f, 0.4f), c2Up), -90, R), SphericalPlayer.Tangent(new Vector3(1f, 0.3f, 0.4f), c2Up)));
            Vector3 pH = new Vector3(1, 0, 0.15f);
            cases.Add(("north_pole", Offset(new Vec3d(0, 1, 0), pH, -90, R), pH));
            cases.Add(("south_pole", Offset(new Vec3d(0, -1, 0), pH, -90, R), pH));
            Vector3 aEast = V(anchor.East);
            cases.Add(("authored_region_across_face_edge", anchor.FromLocal(-330, -120), aEast));
            Vec3d anti = -aDir; Vector3 antiH = SphericalPlayer.Tangent(new Vector3(0.3f, 1f, 0.2f), V(anti));
            cases.Add(("antipode", Offset(anti, antiH, -90, R), antiH));

            json.Append(",\n  \"walks\": [\n"); bool firstWalk = true; int passedAll = 0;
            foreach (var c in cases)
            {
                Vector3 startUp = V(c.start);
                player.PlaceAt(c.start, c.heading);
                rig.Forward = SphericalPlayer.Tangent(c.heading, startUp); rig.Pitch = 14f;
                player.Velocity = Vector3.zero;
                cam.transform.position = player.transform.position + startUp * 5f;
                tree.Prewarm();
                for (int f = 0; f < 20; f++) yield return null;
                yield return Shot("20_walk_" + c.name + "_start");

                double minBelow = 1e9, maxBelow = -1e9, maxClear = -1e9, minClear = 1e9; int nan = 0, ticks = 0, grounded = 0, faceChanges = 0, lastFace = -1; double moved = 0; Vec3d prev = player.PosD;
                float sim = 0; bool shotMid = false; var faces = new HashSet<int>();
                while (sim < 22f)
                {
                    for (int s = 0; s < 3; s++)
                    {
                        player.Tick(1f / 60f, new InputFrame { moveY = 1f, sprint = true }, rig.TangentForward, false);
                        sim += 1f / 60f; ticks++;
                        Vec3d d = player.PosD.Normalized;
                        double clear = player.PosD.Length - player.GroundRadius; minClear = Math.Min(minClear, clear); maxClear = Math.Max(maxClear, clear);
                        if (player.Grounded) grounded++;
                        double meshR = tree.SampleMeshRadius(d);
                        if (double.IsNaN(meshR)) nan++; else { double below = meshR - player.PosD.Length; minBelow = Math.Min(minBelow, below); maxBelow = Math.Max(maxBelow, below); }
                        CubeSphere.FromDirection(d, out int face, out _, out _);
                        faces.Add(face); if (lastFace >= 0 && face != lastFace) faceChanges++; lastFace = face;
                        moved += (player.PosD - prev).Length; prev = player.PosD;
                    }
                    if (!shotMid && sim > 8f) { shotMid = true; yield return Shot("21_walk_" + c.name + "_mid"); }
                    yield return null;
                }
                yield return Shot("22_walk_" + c.name + "_end");
                bool pass = maxBelow < 0.15 && faceChanges >= (c.name.StartsWith("edge") || c.name.StartsWith("corner") ? 1 : 0) && Math.Abs(minClear) < 0.01 && Math.Abs(maxClear) < 0.7 && nan == 0;
                if (pass) passedAll++;
                if (!firstWalk) json.Append(",\n"); firstWalk = false;
                json.Append($"    {{\"name\":\"{c.name}\",\"movedM\":{F(moved)},\"ticks\":{ticks},\"groundedTicks\":{grounded},\"facesVisited\":{faces.Count},\"faceChanges\":{faceChanges}," +
                            $"\"maxFeetBelowRenderedMeshM\":{F(maxBelow)},\"minFeetBelowRenderedMeshM\":{F(minBelow)},\"minClearanceM\":{F(minClear)},\"maxClearanceM\":{F(maxClear)},\"unstreamedSamples\":{nan},\"pass\":{(pass ? "true" : "false")}}}");
            }
            json.Append("\n  ],\n"); firstEntry = true; json.Append("  \"walksPassed\": " + passedAll + ",\n  \"walksTotal\": " + cases.Count);
            firstEntry = false;

            // ---------- streaming fly-over: fast great-circle traverse at 250 m/s, 40 m above ground
            player.PlaceAt(aDir, SphericalPlayer.Tangent(V(anchor.North) , V(aDir)));
            Vec3d pos = aDir; Vector3 head = SphericalPlayer.Tangent(V(anchor.East) * 0.8f + V(anchor.North) * 0.6f, V(aDir));
            rig.FreeOrbit = true;
            var frameMs = new List<float>(); long peakMesh = 0; int peakActive = 0, peakQueued = 0, builtAt0 = tree.TotalBuilt, releasedAt0 = tree.TotalReleased; double travelled = 0;
            var memSamples = new List<long>();
            float tf = 0;
            while (tf < 24f)
            {
                float dt = Mathf.Min(Time.deltaTime, 0.05f); tf += dt;
                double step = 250.0 * dt; travelled += step;
                Vec3d np = Offset(pos, head, step, R);
                head = SphericalPlayer.Tangent(GreatCircleHeading(pos, np), V(np)); pos = np;
                double alt = 40;
                double rr = R + boot.Field.Height(pos) + alt;
                cam.transform.position = new Vector3((float)(pos.x * rr), (float)(pos.y * rr), (float)(pos.z * rr));
                cam.transform.rotation = Quaternion.LookRotation(head, V(pos));
                frameMs.Add(Time.unscaledDeltaTime * 1000f);
                peakMesh = Math.Max(peakMesh, tree.MeshBytes); peakActive = Math.Max(peakActive, tree.ActiveCount); peakQueued = Math.Max(peakQueued, tree.QueuedCount);
                if (frameMs.Count % 60 == 0) memSamples.Add(UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong());
                if (tf > 8f && tf < 8.05f) yield return Shot("30_flyover_a");
                if (tf > 16f && tf < 16.05f) yield return Shot("31_flyover_b");
                yield return null;
            }
            long meshBeforeStop = tree.MeshBytes;
            for (int f = 0; f < 240; f++) yield return null;
            frameMs.Sort();
            float avg = 0; foreach (var m in frameMs) avg += m; avg /= Mathf.Max(1, frameMs.Count);
            json.Append($",\n  \"flyover\": {{\"speedMps\":250,\"travelledM\":{F(travelled)},\"frames\":{frameMs.Count},\"avgMs\":{F(avg)},\"p99Ms\":{F(frameMs[(int)(frameMs.Count * 0.99f)])},\"maxMs\":{F(frameMs[frameMs.Count - 1])}," +
                        $"\"patchesBuilt\":{tree.TotalBuilt - builtAt0},\"patchesReleased\":{tree.TotalReleased - releasedAt0},\"peakActivePatches\":{peakActive},\"peakQueued\":{peakQueued},\"peakMeshMB\":{F(peakMesh / 1048576.0)},\"finalMeshMB\":{F(tree.MeshBytes / 1048576.0)},\"finalActivePatches\":{tree.ActiveCount}}}");
            json.Append(",\n  \"memoryMBSamples\": [" + string.Join(",", memSamples.ConvertAll(x => (x / 1048576).ToString())) + "]");
            json.Append("\n}\n");
            File.WriteAllText(Path.Combine(dir, "planet_tests.json"), json.ToString());
            Application.Quit(0);
        }

        static Vector3 V(Vec3d d) => new Vector3((float)d.x, (float)d.y, (float)d.z);
        static Vector3 GreatCircleHeading(Vec3d from, Vec3d to)
        {
            // tangent at `to` pointing away from `from` along the great circle
            return V((to * from.Dot(to) - from).Normalized);
        }
    }
}
