using UnityEngine;

namespace GF.Player
{
    /// <summary>What the animation layer needs from any player controller (flat or spherical).</summary>
    public interface IAstronautSource
    {
        float HorizontalSpeed { get; }
        float VerticalSpeed { get; }
        bool Grounded { get; }
        bool Jetting { get; }
        bool Aiming { get; }
        bool JustJumped { get; }
    }

    /// <summary>
    /// Feeds the animator state machine from the (unchanged) gameplay controller. One-way: animation never
    /// affects physics. All smoothing uses exp(-k*dt), so behaviour is identical at 30, 60 or 120 fps.
    /// </summary>
    [RequireComponent(typeof(Animator))]
    public sealed class AstronautAnimator : MonoBehaviour
    {
        public PlayerController Player;
        public MonoBehaviour Source;          // any IAstronautSource (e.g. SphericalPlayer)
        IAstronautSource src;
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

        public void Bind(MonoBehaviour source) { Source = source; src = source as IAstronautSource; }

        void Update()
        {
            if (src == null) src = Source as IAstronautSource ?? Player;
            if (src == null) return;
            float dt = Time.deltaTime;
            speed = Mathf.Lerp(speed, src.HorizontalSpeed, 1f - Mathf.Exp(-14f * dt));
            anim.SetFloat(pSpeed, speed < 0.05f ? 0f : speed);
            anim.SetBool(pGrounded, src.Grounded);
            anim.SetFloat(pVelY, src.VerticalSpeed);
            anim.SetBool(pJet, src.Jetting);
            anim.SetBool(pMine, src.Aiming && src.Grounded);
            if (src.JustJumped) anim.SetTrigger(pJump);
            if (Jet != null) Jet.SetThrust(src.Jetting ? 1f : 0f);
        }
    }
}
