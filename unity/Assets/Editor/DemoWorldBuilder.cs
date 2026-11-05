using System.Linq;
using GF.Authoring;
using GF.Planet;
using UnityEditor;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>
    /// Creates the "Demo Meadow" region next to the Aetherion landing site using exactly the calls the Scene-view tools use.
    /// It exists so there is something to open, play and change on day one; delete or edit it freely.
    ///   Unity -batchmode -executeMethod GF.EditorTools.DemoWorldBuilder.Build -quit
    /// </summary>
    public static class DemoWorldBuilder
    {
        public static void Build()
        {
            var s = WorldEditorSession.Open();
            const double R = WorldEditorSession.PlanetRadius;
            Vec3d centre = s.Anchor.FromLocal(-40, 55);
            Vec3d Off(double eastM, double northM) => s.Anchor.FromLocal(-40 + eastM, 55 + northM);
            s.World.Regions.Clear(); s.World.Props.Clear(); s.World.Cells.Clear();

            // 1. a gentle knoll with a levelled lookout pad on top
            var raise = new BrushSettings { Kind = BrushKind.Raise, RadiusM = 30, Strength = 7 };
            s.BeginStroke("Knoll", raise, Off(25, 20)); for (int i = 0; i < 18; i++) s.Dab(Off(25, 20), raise, 0.05); s.EndStroke();
            var smooth = new BrushSettings { Kind = BrushKind.Smooth, RadiusM = 36, Strength = 8 };
            s.BeginStroke("Smooth", smooth, Off(25, 20)); for (int i = 0; i < 30; i++) s.Dab(Off(25, 20), smooth, 0.05); s.EndStroke();
            var flat = new BrushSettings { Kind = BrushKind.Flatten, RadiusM = 9, Strength = 8 };
            s.BeginStroke("Pad", flat, Off(25, 20)); for (int i = 0; i < 30; i++) s.Dab(Off(25, 20), flat, 0.05); s.EndStroke();

            // 2. a shallow hollow (dry stream bed) running between the knoll and the landing site
            var lower = new BrushSettings { Kind = BrushKind.Lower, RadiusM = 8, Strength = 3 };
            for (int k = 0; k < 9; k++) { var p = Off(-35 + k * 8, -10 + Mathf.Sin(k * 0.8f) * 6); s.BeginStroke("Stream bed", lower, p); for (int i = 0; i < 8; i++) s.Dab(p, lower, 0.05); s.EndStroke(); }

            // 3. materials: rock on the knoll shoulders, sand in the stream bed, dirt path to the pad, grass left procedural/painted
            var rock = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 13, Strength = 6, Layer = 2 };
            foreach (var (e, n) in new[] { (36.0, 28.0), (14.0, 34.0), (38.0, 10.0) }) { var p = Off(e, n); s.BeginStroke("Rock paint", rock, p); for (int i = 0; i < 8; i++) s.Dab(p, rock, 0.05); s.EndStroke(); }
            var sand = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 7, Strength = 8, Layer = 3 };
            for (int k = 0; k < 9; k++) { var p = Off(-35 + k * 8, -10 + Mathf.Sin(k * 0.8f) * 6); s.BeginStroke("Sand", sand, p); for (int i = 0; i < 6; i++) s.Dab(p, sand, 0.05); s.EndStroke(); }
            var dirt = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 3.5, Strength = 8, Layer = 1 };
            for (int k = 0; k <= 10; k++) { var p = Off(-10 + k * 3.5, 0 + k * 2.1); s.BeginStroke("Path", dirt, p); for (int i = 0; i < 5; i++) s.Dab(p, dirt, 0.05); s.EndStroke(); }

            // 4. vegetation: lush painted meadow in front of the knoll, a cleared yard around the lookout pad
            var grass = new BrushSettings { Kind = BrushKind.PaintVegetation, RadiusM = 16, Strength = 8, VegDensity = 0.95 };
            foreach (var (e, n) in new[] { (-5.0, 38.0), (-25.0, 22.0), (5.0, 10.0) }) { var p = Off(e, n); s.BeginStroke("Meadow", grass, p); for (int i = 0; i < 12; i++) s.Dab(p, grass, 0.05); s.EndStroke(); }
            var clear = new BrushSettings { Kind = BrushKind.ExcludeVegetation, RadiusM = 10, Strength = 8 };
            s.BeginStroke("Keep clear", clear, Off(25, 20)); for (int i = 0; i < 6; i++) s.Dab(Off(25, 20), clear, 0.05); s.EndStroke();

            // 5. rocks: a lookout landmark, boulders around the knoll, pebbles in the stream bed
            string boulder = s.Library.Keys.FirstOrDefault(k => k.Contains("boulder_03")) ?? s.Library.Keys.First();
            string cliff = s.Library.Keys.FirstOrDefault(k => k.Contains("cliff")) ?? boulder;
            string pebbles = s.Library.Keys.FirstOrDefault(k => k.Contains("rock_07")) ?? boulder;
            string boulder2 = s.Library.Keys.FirstOrDefault(k => k.Contains("boulder_02")) ?? boulder;
            s.PlaceProp(cliff, Off(31, 25), 200f, 1.4f, landmark: true);
            s.PlaceProp(boulder, Off(18, 14), 40f, 1.5f); s.PlaceProp(boulder2, Off(34, 12), 120f, 1.9f); s.PlaceProp(boulder, Off(12, 26), 300f, 1.1f); s.PlaceProp(boulder2, Off(40, 30), 75f, 1.3f);
            for (int k = 0; k < 7; k++) s.PlaceProp(pebbles, Off(-30 + k * 9 + (k % 2) * 2, -8 + Mathf.Sin(k * 0.8f) * 6 + 2.2f), k * 53f, 2.2f + (k % 3) * 0.5f);
            s.AddRegion("Demo Meadow", centre, 90);

            s.Save();
            Debug.Log("[GF] demo world saved: " + s.World.Summary());
            // start the playable preview in the demo region
            System.IO.File.WriteAllText("Assets/Resources/Authored/start.txt", $"{Off(-12, -22).x.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} {Off(-12, -22).y.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} {Off(-12, -22).z.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}");
            AssetDatabase.Refresh();
            s.Close();
            EditorApplication.Exit(0);
        }
    }
}
