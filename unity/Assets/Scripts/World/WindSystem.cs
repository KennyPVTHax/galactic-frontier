using UnityEngine;

namespace GF.World
{
    /// <summary>
    /// One shared wind state pushed to every vegetation shader as globals. Gusts are travelling noise fronts
    /// (see GF_Grass.shader), so wind visibly rolls across fields instead of every blade swaying in sync.
    /// </summary>
    public sealed class WindSystem : MonoBehaviour
    {
        [Range(0, 1)] public float strength = 0.55f;
        public float directionDegrees = 62f;
        public float gustSpeed = 7.5f;
        public float gustScale = 0.045f;
        [Tooltip("Slow variation of overall strength so calm and windy spells alternate.")]
        public float breathPeriod = 23f;

        static readonly int WindParams = Shader.PropertyToID("_GF_Wind");     // xy dir, z strength, w time
        static readonly int WindGust = Shader.PropertyToID("_GF_WindGust");   // x speed, y scale, z unused, w unused
        static readonly int Interactor = Shader.PropertyToID("_GF_Interactor"); // xyz position, w radius

        public static Vector3 InteractorPosition;
        public static float InteractorRadius = 1.6f;

        void Update()
        {
            float a = directionDegrees * Mathf.Deg2Rad;
            float breath = 0.75f + 0.25f * Mathf.Sin(Time.time * (Mathf.PI * 2f / breathPeriod))
                                  + 0.1f * Mathf.Sin(Time.time * 0.37f + 1.3f);
            Shader.SetGlobalVector(WindParams, new Vector4(Mathf.Cos(a), Mathf.Sin(a), strength * breath, Time.time));
            Shader.SetGlobalVector(WindGust, new Vector4(gustSpeed, gustScale, 0, 0));
            Shader.SetGlobalVector(Interactor, new Vector4(InteractorPosition.x, InteractorPosition.y, InteractorPosition.z, InteractorRadius));
        }
    }
}
