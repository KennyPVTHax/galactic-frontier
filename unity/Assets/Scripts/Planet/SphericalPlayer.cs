using GF.Player;
using UnityEngine;

namespace GF.Planet
{
    /// <summary>
    /// The TypeScript player (constants and update order unchanged) running on a globe: radial gravity, movement in the
    /// local tangent plane, ground = analytic planet field. Position is kept in double precision. The facing vector is
    /// re-projected onto the tangent plane every tick (parallel transport), so there is no pole singularity.
    /// </summary>
    public sealed class SphericalPlayer : MonoBehaviour, IAstronautSource
    {
        const float WALK = 5.5f, SPRINT = 10f, JUMP_V = 6.8f;

        public IPlanetField Field;
        public double Radius;
        public float Gravity = 13.5f, LiquidLevel = -4f, MaxJetFuel = 100f, JetThrust = 25f;
        public Vec3d PosD;
        public Vector3 Velocity;
        public Vector3 FacingDir = Vector3.forward;
        public bool Grounded = true, Jetting;
        public float JetFuel = 100f;

        public float HorizontalSpeed { get; private set; }
        public float VerticalSpeed { get; private set; }
        public bool JustJumped { get; private set; }
        public bool Landed { get; private set; }
        public bool Aiming { get; private set; }
        public double GroundRadius { get; private set; }
        public Vector3 Up => new Vector3((float)(PosD.x / PosD.Length), (float)(PosD.y / PosD.Length), (float)(PosD.z / PosD.Length));

        bool IAstronautSource.Grounded => Grounded;
        bool IAstronautSource.Jetting => Jetting;

        float sinceJump = 99, groundedTime;

        public static Vector3 Tangent(Vector3 v, Vector3 up)
        {
            Vector3 t = v - up * Vector3.Dot(v, up);
            if (t.sqrMagnitude < 1e-8f) { t = Vector3.Cross(up, Mathf.Abs(up.y) < 0.9f ? Vector3.up : Vector3.right); }
            return t.normalized;
        }

        public void PlaceAt(Vec3d dir, Vector3 facingHint)
        {
            dir = dir.Normalized;
            GroundRadius = Radius + Field.Height(dir);
            PosD = dir * GroundRadius;
            Velocity = Vector3.zero; Grounded = true;
            Vector3 up = new Vector3((float)dir.x, (float)dir.y, (float)dir.z);
            FacingDir = Tangent(facingHint, up);
            Sync(up);
        }

        void Sync(Vector3 up)
        {
            transform.position = new Vector3((float)PosD.x, (float)PosD.y, (float)PosD.z);
            transform.rotation = Quaternion.LookRotation(FacingDir, up);
            GF.World.WindSystem.InteractorPosition = transform.position;
        }

        public void Tick(float dt, InputFrame input, Vector3 camForward, bool aiming)
        {
            Aiming = aiming;
            double len = PosD.Length;
            Vec3d dir = PosD / len;
            Vector3 up = new Vector3((float)dir.x, (float)dir.y, (float)dir.z);
            Vector3 fwd = Tangent(camForward, up);
            Vector3 right = Vector3.Cross(up, fwd);
            Vector3 m = fwd * input.moveY + right * input.moveX;
            float mlen = m.magnitude;
            if (mlen > 1) m /= mlen;

            Vec3d nrm = PatchMesher.StencilNormal(Field, Radius, dir, 1.0 / Radius);
            float ny = (float)nrm.Dot(dir);
            float slopeFactor = Mathf.Clamp((ny - 0.55f) / 0.3f, 0.3f, 1f);
            float wading = (Field.Height(dir)) < LiquidLevel ? 0.55f : 1f;
            float speed = (input.sprint && !aiming ? SPRINT : WALK) * slopeFactor * wading;
            float accel = Grounded ? 45f : 9f;

            float vUp = Vector3.Dot(Velocity, up);
            Vector3 vH = Velocity - up * vUp;
            Vector3 target = m * speed;
            float k = Mathf.Min(1f, accel * dt / Mathf.Max(0.001f, speed));
            float blend = Grounded ? Mathf.Min(1f, k * 2f) : 1f - Mathf.Exp(-1.2f * dt);
            vH += (target - vH) * blend;

            sinceJump += dt; JustJumped = false; Landed = false;
            if (Grounded && input.jumpPressed) { vUp = JUMP_V; Grounded = false; sinceJump = 0; JustJumped = true; }
            Jetting = false;
            if (!Grounded && input.jumpHeld && sinceJump > 0.22f && JetFuel > 0)
            {
                Jetting = true;
                vUp = Mathf.Min(9f, vUp + JetThrust * dt);
                JetFuel = Mathf.Max(0, JetFuel - 30f * dt);
                vH += m * 6f * dt;
            }
            vUp -= Gravity * dt;

            Velocity = vH + up * vUp;
            PosD = PosD + new Vec3d(Velocity.x, Velocity.y, Velocity.z) * dt;

            // ground (analytic planet surface)
            len = PosD.Length; dir = PosD / len;
            GroundRadius = Radius + Field.Height(dir);
            Vector3 up2 = new Vector3((float)dir.x, (float)dir.y, (float)dir.z);
            vUp = Vector3.Dot(Velocity, up2);
            bool was = Grounded;
            if (len <= GroundRadius) { PosD = dir * GroundRadius; if (vUp < 0) { Velocity -= up2 * vUp; vUp = 0; } Grounded = true; }
            else if (Grounded && vUp <= 0 && len - GroundRadius < 0.6) { PosD = dir * GroundRadius; Velocity -= up2 * vUp; vUp = 0; }
            else Grounded = false;
            if (Grounded && !was) Landed = true;

            if (Grounded) { groundedTime += dt; if (groundedTime > 0.4f) JetFuel = Mathf.Min(MaxJetFuel, JetFuel + 38f * dt); }
            else groundedTime = 0;

            Vector3 vH2 = Velocity - up2 * Vector3.Dot(Velocity, up2);
            float hs = vH2.magnitude;
            if (aiming) FacingDir = Vector3.Slerp(FacingDir, Tangent(camForward, up2), 1f - Mathf.Exp(-14f * dt));
            else if (hs > 0.4f && mlen > 0.05f) FacingDir = Vector3.Slerp(Tangent(FacingDir, up2), vH2 / hs, 1f - Mathf.Exp(-10f * dt));
            FacingDir = Tangent(FacingDir, up2);

            HorizontalSpeed = hs; VerticalSpeed = vUp;
            Sync(up2);
        }
    }
}
