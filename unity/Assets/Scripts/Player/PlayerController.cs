using System.Collections.Generic;
using GF.World;
using UnityEngine;

namespace GF.Player
{
    /// <summary>Circle-with-a-top collider, same data model as the TypeScript game (boulders you can walk onto).</summary>
    public struct RockCollider { public float x, z, r, top; }

    public struct InputFrame
    {
        public float moveX, moveY;     // -1..1 (moveY forward)
        public float lookX, lookY;     // delta this frame, in degrees
        public bool sprint, jumpPressed, jumpHeld, mine, interact;
    }

    /// <summary>
    /// Direct port of src/player/player.ts (same constants and update order). Ground contact uses the baked
    /// Heightmap, i.e. the same surface that is rendered. The Animator is purely cosmetic and never feeds back
    /// into physics, so gameplay stays identical whatever the animation does.
    /// </summary>
    public sealed class PlayerController : MonoBehaviour
    {
        const float WALK = 5.5f, SPRINT = 10f, JUMP_V = 6.8f, RADIUS = 0.4f;

        public Heightmap Map;
        public float Gravity = 13.5f;
        public float WalkRadius = 640f;
        public float LiquidLevel = -4f;
        public float MaxJetFuel = 100f, JetThrust = 25f;

        public Vector3 Velocity;
        public float Facing;                       // radians, 0 = +z
        public bool Grounded = true, Jetting;
        public float JetFuel = 100f;
        public readonly List<RockCollider> Colliders = new List<RockCollider>();

        // cosmetic outputs for the animation layer
        public float HorizontalSpeed { get; private set; }
        public float Lean { get; private set; }
        public float TimeSinceLanded { get; private set; } = 99f;
        public bool JustJumped { get; private set; }
        public bool Aiming { get; private set; }
        public bool Landed { get; private set; }
        public float LandImpact { get; private set; }

        float sinceJump = 99, groundedTime;

        public void Place(float x, float z, float yaw = 0)
        {
            transform.position = new Vector3(x, Map.Height(x, z), z);
            Velocity = Vector3.zero; Facing = yaw; Grounded = true;
            transform.rotation = Quaternion.Euler(0, yaw * Mathf.Rad2Deg, 0);
        }

        float Support(float x, float z, float y)
        {
            float g = Map.Height(x, z);
            foreach (var c in Colliders)
            {
                float d = Mathf.Sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z));
                if (d < c.r * 0.75f && y >= c.top - 0.35f) g = Mathf.Max(g, c.top);
            }
            return g;
        }

        public void Tick(float dt, InputFrame input, float camYaw, bool aiming)
        {
            Aiming = aiming;
            Vector3 pos = transform.position;
            float fx = Mathf.Sin(camYaw), fz = Mathf.Cos(camYaw);
            float rx = Mathf.Cos(camYaw), rz = -Mathf.Sin(camYaw);
            float mx = fx * input.moveY + rx * input.moveX;
            float mz = fz * input.moveY + rz * input.moveX;
            float mlen = Mathf.Sqrt(mx * mx + mz * mz);
            if (mlen > 1) { mx /= mlen; mz /= mlen; }

            float ny = Map.Normal(pos.x, pos.z).y;
            float slopeFactor = Mathf.Clamp((ny - 0.55f) / 0.3f, 0.3f, 1f);
            float wading = Map.Height(pos.x, pos.z) < LiquidLevel ? 0.55f : 1f;
            float speed = (input.sprint && !aiming ? SPRINT : WALK) * slopeFactor * wading;
            float accel = Grounded ? 45f : 9f;
            float tvx = mx * speed, tvz = mz * speed;
            float k = Mathf.Min(1f, accel * dt / Mathf.Max(0.001f, speed));
            float blend = Grounded ? Mathf.Min(1f, k * 2f) : 1f - Mathf.Exp(-1.2f * dt);
            Velocity.x += (tvx - Velocity.x) * blend;
            Velocity.z += (tvz - Velocity.z) * blend;

            // jump / jetpack
            sinceJump += dt;
            JustJumped = false; Landed = false;
            if (Grounded && input.jumpPressed)
            {
                Velocity.y = JUMP_V; Grounded = false; sinceJump = 0; JustJumped = true;
            }
            Jetting = false;
            if (!Grounded && input.jumpHeld && sinceJump > 0.22f && JetFuel > 0)
            {
                Jetting = true;
                Velocity.y = Mathf.Min(9f, Velocity.y + JetThrust * dt);
                JetFuel = Mathf.Max(0, JetFuel - 30f * dt);
                Velocity.x += mx * 6f * dt;
                Velocity.z += mz * 6f * dt;
            }
            Velocity.y -= Gravity * dt;

            float preVy = Velocity.y;
            Vector3 old = pos;
            pos += Velocity * dt;

            // horizontal collisions against boulders
            foreach (var c in Colliders)
            {
                if (pos.y >= c.top - 0.35f) continue;
                float dx = pos.x - c.x, dz = pos.z - c.z;
                float d = Mathf.Sqrt(dx * dx + dz * dz);
                float min = c.r + RADIUS;
                if (d < min && d > 1e-4f) { pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; }
            }

            // soft world boundary
            float r = Mathf.Sqrt(pos.x * pos.x + pos.z * pos.z);
            if (r > WalkRadius) { pos.x *= WalkRadius / r; pos.z *= WalkRadius / r; }

            // ground
            bool wasGrounded = Grounded;
            float g = Support(pos.x, pos.z, pos.y);
            if (pos.y <= g)
            {
                pos.y = g;
                if (Velocity.y < 0) Velocity.y = 0;
                Grounded = true;
            }
            else if (Grounded && Velocity.y <= 0 && pos.y - g < 0.6f)
            {
                pos.y = g; Velocity.y = 0;
            }
            else Grounded = false;

            if (Grounded && !wasGrounded) { Landed = true; LandImpact = Mathf.Abs(preVy); TimeSinceLanded = 0; }
            else TimeSinceLanded += dt;

            if (Grounded)
            {
                groundedTime += dt;
                if (groundedTime > 0.4f) JetFuel = Mathf.Min(MaxJetFuel, JetFuel + 38f * dt);
            }
            else groundedTime = 0;

            // facing
            float hs = Mathf.Sqrt(Velocity.x * Velocity.x + Velocity.z * Velocity.z);
            if (aiming) Facing += Wrap(camYaw - Facing) * (1f - Mathf.Exp(-14f * dt));
            else if (hs > 0.4f && mlen > 0.05f) Facing += Wrap(Mathf.Atan2(Velocity.x, Velocity.z) - Facing) * (1f - Mathf.Exp(-10f * dt));

            HorizontalSpeed = hs;
            Lean = Mathf.Lerp(Lean, Wrap(Mathf.Atan2(Velocity.x, Velocity.z) - Facing) * Mathf.Clamp01(hs / SPRINT), 1f - Mathf.Exp(-8f * dt));
            transform.position = pos;
            transform.rotation = Quaternion.Euler(0, Facing * Mathf.Rad2Deg, 0);
            WindSystem.InteractorPosition = pos;
        }

        static float Wrap(float a)
        {
            while (a > Mathf.PI) a -= Mathf.PI * 2;
            while (a < -Mathf.PI) a += Mathf.PI * 2;
            return a;
        }
    }
}
