using UnityEngine;

namespace GF.Player
{
    /// <summary>
    /// Feeds the animator state machine from the (unchanged) gameplay controller. One-way: animation never
    /// affects physics. All smoothing uses exp(-k*dt), so behaviour is identical at 30, 60 or 120 fps.
    /// </summary>
    [RequireComponent(typeof(Animator))]
    public sealed class AstronautAnimator : MonoBehaviour
    {
        public PlayerController Player;
        public JetpackFx Jet;
        Animator anim;
        float speed;

        static readonly int pSpeed = Animator.StringToHash("Speed");
        static readonly int pGrounded = Animator.StringToHash("Grounded");
        static readonly int pVelY = Animator.StringToHash("VelY");
        static readonly int pJet = Animator.StringToHash("Jet");
        static readonly int pMine = Animator.StringToHash("Mine");
        static readonly int pJump = Animator.StringToHash("Jump");

        void Awake() { anim = GetComponent<Animator>(); anim.applyRootMotion = false; }

        void Update()
        {
            if (Player == null) return;
            float dt = Time.deltaTime;
            speed = Mathf.Lerp(speed, Player.HorizontalSpeed, 1f - Mathf.Exp(-14f * dt));
            anim.SetFloat(pSpeed, speed < 0.05f ? 0f : speed);
            anim.SetBool(pGrounded, Player.Grounded);
            anim.SetFloat(pVelY, Player.Velocity.y);
            anim.SetBool(pJet, Player.Jetting);
            anim.SetBool(pMine, Player.Aiming && Player.Grounded);
            if (Player.JustJumped) anim.SetTrigger(pJump);
            if (Jet != null) Jet.SetThrust(Player.Jetting ? 1f : 0f);
        }
    }
}
