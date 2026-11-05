using UnityEngine;
using UnityEngine.InputSystem;

namespace GF.Player
{
    /// <summary>
    /// Keyboard/mouse, gamepad and a minimal on-screen touch scheme (left = floating stick, right = look,
    /// buttons bottom-right). The touch overlay is drawn with IMGUI for the prototype; the final UI replaces it.
    /// </summary>
    public sealed class GameInput : MonoBehaviour
    {
        public float LookSensitivity = 0.12f;      // degrees per pixel (mouse) / per px (touch)
        public float TouchLookSensitivity = 0.18f;
        public bool ForceTouchUi;

        InputFrame frame;
        int stickId = -1, lookId = -1;
        Vector2 stickOrigin, stickNow, lastLook;
        bool touchJumpHeld, touchSprint, touchMine, jumpEdge;
        Rect jumpBtn, sprintBtn, mineBtn;

        public bool TouchActive => ForceTouchUi || (Touchscreen.current != null && Application.isMobilePlatform);
        public InputFrame Frame => frame;

        void OnEnable() { UnityEngine.InputSystem.EnhancedTouch.EnhancedTouchSupport.Enable(); }
        void OnDisable() { UnityEngine.InputSystem.EnhancedTouch.EnhancedTouchSupport.Disable(); }

        void Layout()
        {
            float s = Mathf.Min(Screen.width, Screen.height) * 0.20f;
            float m = s * 0.25f;
            jumpBtn = new Rect(Screen.width - s - m, Screen.height - s - m, s, s);
            sprintBtn = new Rect(Screen.width - s * 1.9f - m, Screen.height - s * 0.8f - m, s * 0.8f, s * 0.8f);
            mineBtn = new Rect(Screen.width - s - m, Screen.height - s * 2.15f - m, s * 0.9f, s * 0.9f);
        }

        void Update()
        {
            Layout();
            var f = new InputFrame();
            bool pressed = false;

            var kb = Keyboard.current;
            var ms = Mouse.current;
            if (kb != null)
            {
                f.moveX = (kb.dKey.isPressed ? 1 : 0) - (kb.aKey.isPressed ? 1 : 0);
                f.moveY = (kb.wKey.isPressed ? 1 : 0) - (kb.sKey.isPressed ? 1 : 0);
                f.sprint = kb.leftShiftKey.isPressed;
                f.jumpHeld = kb.spaceKey.isPressed;
                pressed = kb.spaceKey.wasPressedThisFrame;
                f.interact = kb.eKey.wasPressedThisFrame;
            }
            if (ms != null)
            {
                f.mine |= ms.leftButton.isPressed;
                if (ms.rightButton.isPressed || Cursor.lockState == CursorLockMode.Locked)
                {
                    var d = ms.delta.ReadValue();
                    f.lookX += d.x * LookSensitivity; f.lookY += d.y * LookSensitivity;
                }
                if (ms.leftButton.wasPressedThisFrame && Cursor.lockState != CursorLockMode.Locked && !TouchActive)
                { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            }
            if (kb != null && kb.escapeKey.wasPressedThisFrame) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }

            var gp = Gamepad.current;
            if (gp != null)
            {
                var l = gp.leftStick.ReadValue(); var r = gp.rightStick.ReadValue();
                if (l.sqrMagnitude > 0.04f) { f.moveX = l.x; f.moveY = l.y; }
                f.lookX += r.x * 140f * Time.unscaledDeltaTime; f.lookY += r.y * 140f * Time.unscaledDeltaTime;
                f.sprint |= gp.leftStickButton.isPressed;
                f.jumpHeld |= gp.buttonSouth.isPressed;
                pressed |= gp.buttonSouth.wasPressedThisFrame;
                f.mine |= gp.rightTrigger.isPressed;
            }

            if (TouchActive) ReadTouch(ref f, ref pressed);

            f.jumpPressed = pressed;
            frame = f;
        }

        void ReadTouch(ref InputFrame f, ref bool pressed)
        {
            var touches = UnityEngine.InputSystem.EnhancedTouch.Touch.activeTouches;
            bool jumpNow = false, sprintNow = false, mineNow = false;
            foreach (var t in touches)
            {
                Vector2 p = t.screenPosition;
                Vector2 gui = new Vector2(p.x, Screen.height - p.y);
                if (t.phase == UnityEngine.InputSystem.TouchPhase.Began)
                {
                    if (jumpBtn.Contains(gui) || sprintBtn.Contains(gui) || mineBtn.Contains(gui)) { /* button handled below */ }
                    else if (p.x < Screen.width * 0.45f && stickId < 0) { stickId = t.touchId; stickOrigin = p; stickNow = p; }
                    else if (lookId < 0) { lookId = t.touchId; lastLook = p; }
                }
                if (t.touchId == stickId) stickNow = p;
                else if (t.touchId == lookId)
                {
                    var d = p - lastLook; lastLook = p;
                    f.lookX += d.x * TouchLookSensitivity; f.lookY += d.y * TouchLookSensitivity;
                }
                else
                {
                    if (jumpBtn.Contains(gui)) { jumpNow = true; if (t.phase == UnityEngine.InputSystem.TouchPhase.Began) pressed = true; }
                    if (sprintBtn.Contains(gui)) sprintNow = true;
                    if (mineBtn.Contains(gui)) mineNow = true;
                }
                if (t.phase == UnityEngine.InputSystem.TouchPhase.Ended || t.phase == UnityEngine.InputSystem.TouchPhase.Canceled)
                {
                    if (t.touchId == stickId) stickId = -1;
                    if (t.touchId == lookId) lookId = -1;
                }
            }
            if (stickId >= 0)
            {
                float radius = Mathf.Min(Screen.width, Screen.height) * 0.12f;
                Vector2 d = Vector2.ClampMagnitude((stickNow - stickOrigin) / radius, 1f);
                f.moveX = d.x; f.moveY = d.y;
            }
            touchJumpHeld = jumpNow; touchSprint = sprintNow; touchMine = mineNow;
            f.jumpHeld |= jumpNow; f.sprint |= sprintNow; f.mine |= mineNow;
        }

        void OnGUI()
        {
            if (!TouchActive) return;
            DrawBtn(jumpBtn, "JUMP\nJET", touchJumpHeld);
            DrawBtn(sprintBtn, "RUN", touchSprint);
            DrawBtn(mineBtn, "MINE", touchMine);
            if (stickId >= 0)
            {
                var o = new Vector2(stickOrigin.x, Screen.height - stickOrigin.y);
                var n = new Vector2(stickNow.x, Screen.height - stickNow.y);
                float r = Mathf.Min(Screen.width, Screen.height) * 0.12f;
                Ring(o, r, 0.25f); Ring(o + Vector2.ClampMagnitude(n - o, r), r * 0.42f, 0.5f);
            }
        }

        static void DrawBtn(Rect r, string label, bool down)
        {
            var c = GUI.color; GUI.color = new Color(1, 1, 1, down ? 0.55f : 0.28f);
            GUI.Box(r, label); GUI.color = c;
        }

        static Texture2D dot;
        static void Ring(Vector2 c, float r, float a)
        {
            if (dot == null) { dot = Texture2D.whiteTexture; }
            var old = GUI.color; GUI.color = new Color(1, 1, 1, a);
            GUI.DrawTexture(new Rect(c.x - r, c.y - r, r * 2, r * 2), dot);
            GUI.color = old;
        }
    }
}
