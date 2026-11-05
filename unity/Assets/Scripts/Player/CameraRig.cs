using GF.World;
using UnityEngine;

namespace GF.Player
{
    /// <summary>Third-person orbit camera with terrain avoidance and damped follow.</summary>
    public sealed class CameraRig : MonoBehaviour
    {
        public Transform Target;
        public Heightmap Map;
        public float Distance = 4.6f;
        public float Height = 1.55f;
        public float MinPitch = -25f, MaxPitch = 70f;
        public float Yaw = 0f, Pitch = 18f;       // degrees
        public float YawRadians => Yaw * Mathf.Deg2Rad;

        Vector3 smoothedTarget;

        public void Look(float dx, float dy)
        {
            Yaw += dx;
            Pitch = Mathf.Clamp(Pitch + dy, MinPitch, MaxPitch);
        }

        void LateUpdate()
        {
            if (Target == null) return;
            Vector3 focus = Target.position + Vector3.up * Height;
            smoothedTarget = Vector3.Lerp(smoothedTarget == Vector3.zero ? focus : smoothedTarget, focus, 1f - Mathf.Exp(-18f * Time.deltaTime));
            var rot = Quaternion.Euler(Pitch, Yaw, 0);
            Vector3 pos = smoothedTarget - rot * Vector3.forward * Distance;
            if (Map != null)
            {
                float g = Map.Height(pos.x, pos.z) + 0.6f;
                if (pos.y < g) pos.y = g;
            }
            transform.SetPositionAndRotation(pos, Quaternion.LookRotation(smoothedTarget - pos + Vector3.up * 0.15f, Vector3.up));
        }
    }
}
