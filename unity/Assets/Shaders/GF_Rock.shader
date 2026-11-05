// GF/Rock — PBR rock (Poly Haven diff / GL normal / ARM maps) with world-space moss/dust on upward faces
// and cavity darkening. URP lit + shadows. Tangents come from the model importer (Mikk).
Shader "GF/Rock"
{
    Properties
    {
        [MainTexture] _BaseMap ("Albedo", 2D) = "white" {}
        _BumpMap ("Normal (GL)", 2D) = "bump" {}
        _ArmMap ("AO / Rough / Metal", 2D) = "white" {}
        _Tint ("Tint", Color) = (1, 1, 1, 1)
        _NormalStrength ("Normal strength", Range(0, 2)) = 1
        _MossColor ("Top cover colour", Color) = (0.20, 0.34, 0.14, 1)
        _MossAmount ("Top cover amount", Range(0, 1)) = 0.5
        _MossHeightFade ("Cover: fade by local height", Float) = 0.0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #define GF_DEBUG 1
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            TEXTURE2D(_BumpMap);
            TEXTURE2D(_ArmMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST, _Tint, _MossColor;
                float _NormalStrength, _MossAmount, _MossHeightFade;
            CBUFFER_END

            struct A { float4 p : POSITION; float3 n : NORMAL; float4 t : TANGENT; float2 uv : TEXCOORD0; };
            struct V
            {
                float4 pos : SV_POSITION; float3 pw : TEXCOORD0; float3 nw : TEXCOORD1; float4 tw : TEXCOORD2;
                float2 uv : TEXCOORD3; float fog : TEXCOORD4;
            };

            float hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
            float vnoise(float2 p)
            {
                float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(hash21(i), hash21(i + float2(1, 0)), f.x), lerp(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
            }

            V vert(A i)
            {
                V o;
                o.pw = TransformObjectToWorld(i.p.xyz);
                o.pos = TransformWorldToHClip(o.pw);
                o.nw = TransformObjectToWorldNormal(i.n);
                o.tw = float4(TransformObjectToWorldDir(i.t.xyz), i.t.w * GetOddNegativeScale());
                o.uv = i.uv * _BaseMap_ST.xy + _BaseMap_ST.zw;
                o.fog = ComputeFogFactor(o.pos.z);
                return o;
            }

            half4 frag(V i) : SV_Target
            {
                float3 alb = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).rgb * _Tint.rgb;
                float3 tn = SAMPLE_TEXTURE2D(_BumpMap, sampler_BaseMap, i.uv).rgb * 2 - 1;
                tn.xy *= _NormalStrength;
                float3 arm = SAMPLE_TEXTURE2D(_ArmMap, sampler_BaseMap, i.uv).rgb;

                float3 N0 = normalize(i.nw);
                float3 Tr = i.tw.xyz;
                bool okT = dot(Tr, Tr) > 1e-6 && all(isfinite(Tr)) && abs(i.tw.w) > 0.5;
                float3 T = okT ? normalize(Tr) : normalize(cross(N0, float3(0, 0, 1)) + float3(1e-4, 0, 0));
                float3 B = cross(N0, T) * (okT ? i.tw.w : 1.0);
                float3 N = normalize(tn.x * T + tn.y * B + tn.z * N0);
                if (!all(isfinite(N))) N = N0;

                // top cover (moss / dust): upward-facing, broken up by noise, less in cavities
                float up = saturate(N.y * 0.5 + 0.5);
                float n1 = vnoise(i.pw.xz * 2.7) * 0.6 + vnoise(i.pw.xz * 9.1) * 0.4;
                float cover = smoothstep(0.62 - _MossAmount * 0.25, 0.92, up + (n1 - 0.5) * 0.45) * smoothstep(0.2, 0.7, arm.r) * _MossAmount * 1.6;
                cover = saturate(cover);
                alb = lerp(alb, _MossColor.rgb * (0.7 + 0.6 * n1), cover);
                float rough = lerp(arm.g, 0.88, cover);

                #if defined(GF_DEBUG)
                return half4(alb, 1);
                #endif
                SurfaceData sd = (SurfaceData)0;
                sd.albedo = alb;
                sd.metallic = 0;
                sd.smoothness = saturate(1.0 - rough);
                sd.occlusion = arm.r;
                sd.alpha = 1;
                sd.normalTS = float3(0, 0, 1);

                InputData id = (InputData)0;
                id.positionWS = i.pw;
                id.normalWS = N;
                id.viewDirectionWS = normalize(_WorldSpaceCameraPos - i.pw);
                id.shadowCoord = TransformWorldToShadowCoord(i.pw);
                id.fogCoord = i.fog;
                id.bakedGI = SampleSH(N);
                id.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(i.pos);
                id.shadowMask = half4(1, 1, 1, 1);
                half4 c = UniversalFragmentPBR(id, sd);
                c.rgb = MixFog(c.rgb, i.fog);
                c.rgb = clamp(c.rgb, 0.0, 6.0);
                c.a = 1;
                return c;
            }
            ENDHLSL
        }
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0
            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection; float3 _LightPosition;
            struct A { float4 p : POSITION; float3 n : NORMAL; };
            struct V { float4 pos : SV_POSITION; };
            V vert(A i)
            {
                V o;
                float3 pw = TransformObjectToWorld(i.p.xyz);
                float3 nw = TransformObjectToWorldNormal(i.n);
                float3 ld = _LightDirection;
                o.pos = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(pw, nw, ld)));
                return o;
            }
            half4 frag(V i) : SV_Target { return 0; }
            ENDHLSL
        }
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On ColorMask R
            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct A { float4 p : POSITION; };
            struct V { float4 pos : SV_POSITION; };
            V vert(A i) { V o; o.pos = TransformObjectToHClip(i.p.xyz); return o; }
            half frag(V i) : SV_Target { return i.pos.z; }
            ENDHLSL
        }
    }
}
