using UnityEngine;

namespace GF.Planet
{
    /// <summary>
    /// Third-person camera for a globe. Keeps a tangent "forward" vector that is parallel-transported as the target
    /// moves (no gimbal lock at poles, no flipping across cube edges). Yaw rotates about local up; pitch is separate.
    /// </summary>
    public sealed class SphericalCameraRig : MonoBehaviour
    {
        public SphericalPlayer Target;
        public IPlanetField Field;
        public double Radius;
        public float Distance = 4.6f, Height = 1.55f, Pitch = 16f, MinPitch = -25f, MaxPitch = 75f;
        public Vector3 Forward = Vector3.forward;          // tangent to the sphere under the target
        public bool FreeOrbit;                             // used by globe overview shots
        Vector3 smoothed; bool init;

        public Vector3 TangentForward => Target != null ? SphericalPlayer.Tangent(Forward, Target.Up) : Forward;

        public void Look(float yawDeg, float pitchDeg)
        {
            if (Target == null) return;
            Vector3 up = Target.Up;
            Forward = Quaternion.AngleAxis(yawDeg, up) * SphericalPlayer.Tangent(Forward, up);
            Pitch = Mathf.Clamp(Pitch + pitchDeg, MinPitch, MaxPitch);
        }

        void LateUpdate()
        {
            if (Target == null || FreeOrbit) return;
            Vector3 up = Target.Up;
            Forward = SphericalPlayer.Tangent(Forward, up);                // parallel transport
            Vector3 focus = Target.transform.position + up * Height;
            smoothed = init ? Vector3.Lerp(smoothed, focus, 1f - Mathf.Exp(-18f * Time.deltaTime)) : focus; init = true;
            Quaternion rot = Quaternion.LookRotation(Forward, up) * Quaternion.Euler(Pitch, 0, 0);
            Vector3 pos = smoothed - rot * Vector3.forward * Distance;
            if (Field != null)
            {
                Vec3d d = new Vec3d(pos.x, pos.y, pos.z).Normalized;
                double g = Radius + Field.Height(d) + 0.6;
                double r = new Vec3d(pos.x, pos.y, pos.z).Length;
                if (r < g) pos = new Vector3((float)(d.x * g), (float)(d.y * g), (float)(d.z * g));
            }
            Vector3 camUp = (smoothed - pos).sqrMagnitude > 1e-4f ? up : up;
            transform.SetPositionAndRotation(pos, Quaternion.LookRotation(smoothed - pos + up * 0.15f, camUp));
        }
    }
}
