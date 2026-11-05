using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GF.Player;
using UnityEngine;

namespace GF.World
{
    /// <summary>
    /// Developer tool: when the player is launched with  -gfcapture &lt;dir&gt;  it flies a scripted tour, saves
    /// screenshots and writes perf.json (frame times, grass blades drawn), then quits. Used to review the
    /// slice from the PC GPU without a human at the controls. Never active in normal play.
    /// </summary>
    public sealed class AutoCapture : MonoBehaviour
    {
        string dir;
        AetherionBootstrap boot;
        readonly List<float> frameMs = new List<float>();

        void Awake()
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, "-gfcapture");
            if (i < 0 || i + 1 >= args.Length) { enabled = false; return; }
            dir = args[i + 1];
            Directory.CreateDirectory(dir);
            boot = GetComponent<AetherionBootstrap>();
        }

        IEnumerator Start()
        {
            if (!enabled) yield break;
            while (boot.Player == null || boot.Grass == null) yield return null;
            for (int f = 0; f < 90; f++) yield return null;   // let terrain/grass cells stream in
            var player = boot.Player;
            var rig = Camera.main.GetComponent<CameraRig>();
            var driver = FindFirstObjectByType<PlayerDriver>();
            driver.enabled = false;

            // screenshots: [name, offset from player, yaw, pitch, distance]
            var shots = new (string name, float yaw, float pitch, float dist)[]
            {
                ("01_overview", 200f, 14f, 5.5f), ("02_back", 20f, 10f, 4.6f), ("03_grass_low", 215f, -4f, 3.0f),
                ("04_side", 110f, 12f, 4.6f), ("05_high", 200f, 42f, 9f),
            };
            foreach (var s in shots)
            {
                rig.Yaw = s.yaw; rig.Pitch = s.pitch; rig.Distance = s.dist;
                for (int f = 0; f < 20; f++) yield return null;
                yield return Shot(s.name);
            }

            // walk a loop to exercise terrain streaming + grass cell building, recording frame times
            rig.Distance = 4.6f; rig.Pitch = 14f;
            frameMs.Clear();
            float t = 0; int shotIdx = 0;
            while (t < 24f)
            {
                float dt = Mathf.Min(Time.deltaTime, 0.05f);
                t += dt;
                var f = new InputFrame { moveY = 1f, sprint = t > 12f };
                rig.Yaw += 14f * dt;                                   // gentle circle
                player.Tick(dt, f, rig.YawRadians, false);
                frameMs.Add(Time.unscaledDeltaTime * 1000f);
                if (t > shotIdx * 6f + 5f && shotIdx < 4) { yield return Shot($"10_walk_{shotIdx}"); shotIdx++; }
                yield return null;
            }

            // jump + jetpack
            var jf = new InputFrame { jumpPressed = true, jumpHeld = true };
            player.Tick(0.016f, jf, rig.YawRadians, false);
            for (int k = 0; k < 40; k++) { jf.jumpPressed = false; jf.moveY = 0.5f; player.Tick(0.016f, jf, rig.YawRadians, false); yield return null; }
            yield return Shot("20_jetpack");

            WritePerf();
            Application.Quit(0);
        }

        IEnumerator Shot(string name)
        {
            yield return new WaitForEndOfFrame();
            ScreenCapture.CaptureScreenshot(Path.Combine(dir, name + ".png"));
            yield return null;
        }

        void WritePerf()
        {
            if (frameMs.Count == 0) return;
            var sorted = new List<float>(frameMs); sorted.Sort();
            float avg = 0; foreach (var v in sorted) avg += v; avg /= sorted.Count;
            float p99 = sorted[Mathf.Min(sorted.Count - 1, (int)(sorted.Count * 0.99f))];
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append($"  \"gpu\": \"{SystemInfo.graphicsDeviceName}\",\n  \"api\": \"{SystemInfo.graphicsDeviceType}\",\n");
            sb.Append($"  \"resolution\": \"{Screen.width}x{Screen.height}\",\n  \"quality\": {boot.Quality},\n");
            sb.Append($"  \"frames\": {frameMs.Count},\n  \"avgMs\": {avg:F2},\n  \"p99Ms\": {p99:F2},\n  \"avgFps\": {1000f / avg:F1},\n");
            sb.Append($"  \"grassBladesTotal\": {boot.Grass.TotalBlades},\n  \"grassBladesDrawn\": {boot.Grass.DrawnBlades},\n  \"grassCells\": {boot.Grass.LiveCells}\n}}\n");
            File.WriteAllText(Path.Combine(dir, "perf.json"), sb.ToString());
        }
    }
}
