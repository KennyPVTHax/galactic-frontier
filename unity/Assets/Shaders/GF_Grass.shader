// GF/Grass — GPU-driven blades (StructuredBuffer + SV_InstanceID), travelling wind gusts, translucency.
// Blade data (2 x float4 per blade):  [0] = root.xyz, yaw      [1] = height, width, seed, lean
Shader "GF/Grass"
{
    Properties
    {
        _BaseColor ("Root colour", Color) = (0.035, 0.09, 0.04, 1)
        _TipColor ("Tip colour", Color) = (0.38, 0.55, 0.16, 1)
        _AccentColor ("Alien accent tip", Color) = (0.12, 0.62, 0.55, 1)
        _Translucency ("Translucency", Range(0, 2)) = 0.9
        _Smoothness ("Sheen", Range(0, 1)) = 0.25
        _FadeStart ("Fade start (m)", Float) = 55
        _FadeEnd ("Fade end (m)", Float) = 92
        _WindBend ("Wind bend", Float) = 0.75
        _WidthScale ("Width scale (LOD)", Float) = 1
    }

    HLSLINCLUDE
    #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

    StructuredBuffer<float4> _Blades;

    CBUFFER_START(UnityPerMaterial)
        float4 _BaseColor, _TipColor, _AccentColor;
        float _Translucency, _Smoothness, _FadeStart, _FadeEnd, _WindBend, _WidthScale;
    CBUFFER_END

    float4 _GF_Wind;        // xy dir, z strength, w time
    float4 _GF_WindGust;    // x speed, y scale
    float4 _GF_Interactor;  // xyz pos, w radius

    float hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
    float vnoise(float2 p)
    {
        float2 i = floor(p), f = frac(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i), b = hash21(i + float2(1, 0)), c = hash21(i + float2(0, 1)), d = hash21(i + float2(1, 1));
        return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
    }

    struct Attributes { float3 posOS : POSITION; float2 uv : TEXCOORD0; uint iid : SV_InstanceID; };
    struct Varyings
    {
        float4 posCS : SV_POSITION;
        float3 posWS : TEXCOORD0;
        float3 nrmWS : TEXCOORD1;
        float3 data  : TEXCOORD2;   // t, seed, fogFactor
    };

    Varyings Blade(Attributes IN, out bool alive)
    {
        float4 b0 = _Blades[IN.iid * 2];
        float4 b1 = _Blades[IN.iid * 2 + 1];
        float3 root = b0.xyz;
        float yaw = b0.w;
        float height = b1.x, width = b1.y * _WidthScale, seed = b1.z, lean = b1.w;

        float dist = distance(root, _WorldSpaceCameraPos);
        float fade = saturate((_FadeEnd - dist) / max(1.0, _FadeEnd - _FadeStart));
        height *= fade;
        alive = height > 0.01;

        float t = IN.uv.y;                       // 0 root .. 1 tip
        float side = IN.posOS.x;                 // -0.5 .. 0.5
        float t2 = t * t;

        float sy, cy; sincos(yaw, sy, cy);
        float3 fwd = float3(sy, 0, cy);
        float3 right = float3(cy, 0, -sy);

        // --- wind: travelling gust fronts + slow swell + per-blade flutter
        float2 wd = normalize(_GF_Wind.xy + 1e-5);
        float gs = _GF_WindGust.y;
        float2 gp = root.xz * gs - wd * (_GF_Wind.w * _GF_WindGust.x * gs);
        float g = vnoise(gp) * 0.62 + vnoise(gp * 2.7 + 7.1) * 0.38;
        float front = smoothstep(0.30, 0.82, g);
        float swell = 0.5 + 0.5 * sin(dot(root.xz, wd) * 0.12 - _GF_Wind.w * 1.9);
        float amount = _GF_Wind.z * (0.22 + 0.78 * front + 0.22 * swell);
        float flutter = sin(_GF_Wind.w * (3.2 + seed * 2.5) + seed * 40.0 + dot(root.xz, float2(0.7, 0.3))) * (0.04 + 0.10 * amount);

        float3 disp = float3(wd.x, 0, wd.y) * (amount * _WindBend * height * t2)
                    + float3(-wd.y, 0, wd.x) * (flutter * height * t2)
                    + fwd * (lean * height * t2);

        // --- player / ship interaction: bend away and flatten
        float2 away = root.xz - _GF_Interactor.xz;
        float ad = length(away) + 1e-4;
        float push = saturate(1.0 - ad / _GF_Interactor.w);
        push *= push;
        disp += float3(away.x / ad, 0, away.y / ad) * (push * height * 0.95 * t);
        height *= 1.0 - 0.45 * push;

        float taper = 1.0 - t * 0.88;
        float3 pos = root + right * (side * width * taper) + float3(0, t * height, 0) + disp;
        // keep blade length roughly constant when bent
        pos.y -= dot(disp, disp) / (2.0 * max(height, 0.05)) * 0.6;

        // rounded normal blended toward up (soft, non-harsh two-sided lighting)
        float3 n = normalize(fwd + right * (side * 1.1));
        n = normalize(lerp(n, float3(0, 1, 0), 0.45 + 0.2 * t));

        Varyings OUT;
        OUT.posWS = pos;
        OUT.posCS = TransformWorldToHClip(pos);
        OUT.nrmWS = n;
        OUT.data = float3(t, seed, ComputeFogFactor(OUT.posCS.z));
        return OUT;
    }
    ENDHLSL

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry+10" }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Off

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            Varyings vert(Attributes IN)
            {
                bool alive;
                Varyings OUT = Blade(IN, alive);
                if (!alive) OUT.posCS = float4(2, 2, 2, 1);   // collapse culled blades outside clip space
                return OUT;
            }

            half4 frag(Varyings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target
            {
                float t = saturate(IN.data.x), seed = IN.data.y;
                float3 n = normalize(IN.nrmWS);
                n = IS_FRONT_VFACE(face, n, -n);

                // colour: root -> tip, per-blade variation, rare alien-accent tips
                float3 tip = lerp(_TipColor.rgb, _AccentColor.rgb, smoothstep(0.82, 0.97, seed) * 0.8);
                float3 albedo = lerp(_BaseColor.rgb, tip, pow(t, 0.85));
                albedo *= lerp(0.78, 1.18, frac(seed * 17.31));
                float ao = lerp(0.35, 1.0, saturate(t * 1.6));

                float4 sc = TransformWorldToShadowCoord(IN.posWS);
                Light L = GetMainLight(sc);
                float3 V = normalize(_WorldSpaceCameraPos - IN.posWS);
                float ndl = dot(n, L.direction);
                float wrap = saturate((ndl + 0.45) / 1.45);
                float shade = L.shadowAttenuation * L.distanceAttenuation;

                float3 ambient = SampleSH(n) * ao * 1.35;
                float3 diff = albedo * (L.color * wrap * shade + ambient);

                // light shining through the blade towards the viewer
                float vl = saturate(dot(V, -L.direction));
                float trans = pow(vl, 3.0) * smoothstep(0.1, 1.0, t) * _Translucency;
                diff += tip * L.color * trans * shade * 0.9;

                // soft sheen
                float3 H = normalize(L.direction + V);
                float spec = pow(saturate(dot(n, H)), 24.0) * _Smoothness * 0.35 * shade * t;
                float3 col = diff + L.color * spec;
                col = MixFog(col, IN.data.z);
                col = clamp(col, 0.0, 8.0);
                return half4(col, 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            ColorMask R
            Cull Off

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            Varyings vert(Attributes IN)
            {
                bool alive;
                Varyings OUT = Blade(IN, alive);
                if (!alive) OUT.posCS = float4(2, 2, 2, 1);
                return OUT;
            }
            half frag(Varyings IN) : SV_Target { return IN.posCS.z; }
            ENDHLSL
        }
    }
}
