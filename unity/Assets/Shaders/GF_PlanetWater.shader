// GF/Water — depth-aware absorption, animated multi-wave normals, fresnel sky reflection, sun glint, shoreline foam.
// Requires the URP asset's Depth Texture option (enabled by the scene builder).
Shader "GF/PlanetWater"
{
    Properties
    {
        _DeepColor ("Deep colour", Color) = (0.02, 0.12, 0.17, 1)
        _ShallowColor ("Shallow colour", Color) = (0.10, 0.42, 0.42, 1)
        _Clarity ("Clarity (1/m)", Float) = 0.45
        _WaveScale ("Wave scale", Float) = 0.35
        _WaveSpeed ("Wave speed", Float) = 0.6
        _Glint ("Sun glint", Float) = 1.4
        _FoamWidth ("Foam width (m)", Float) = 0.5
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _DeepColor, _ShallowColor;
                float _Clarity, _WaveScale, _WaveSpeed, _Glint, _FoamWidth;
            CBUFFER_END

            float4 _GF_PlanetCenter;

            struct A { float4 p : POSITION; };
            struct V { float4 pos : SV_POSITION; float3 pw : TEXCOORD0; float4 sp : TEXCOORD1; float fog : TEXCOORD2; };

            V vert(A i)
            {
                V o;
                o.pw = TransformObjectToWorld(i.p.xyz);
                o.pos = TransformWorldToHClip(o.pw);
                o.sp = ComputeScreenPos(o.pos);
                o.fog = ComputeFogFactor(o.pos.z);
                return o;
            }

            float hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
            float vnoise(float2 p)
            {
                float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(hash21(i), hash21(i + float2(1, 0)), f.x), lerp(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
            }

            // height-field derivative of a sum of travelling waves + scrolling noise detail
            float2 WaveSlope(float2 p, float t)
            {
                float2 s = 0;
                const float2 dirs[4] = { float2(0.8, 0.6), float2(-0.6, 0.8), float2(0.3, -0.95), float2(-0.9, -0.4) };
                const float freq[4] = { 0.55, 0.9, 1.7, 2.9 };
                const float amp[4] = { 0.060, 0.038, 0.020, 0.010 };
                [unroll] for (int k = 0; k < 4; k++)
                {
                    float ph = dot(p, dirs[k]) * freq[k] + t * (0.8 + k * 0.35);
                    s += dirs[k] * (cos(ph) * freq[k] * amp[k]);
                }
                float2 q = p * 2.3 + t * float2(0.11, 0.07);
                s += (float2(vnoise(q), vnoise(q + 17.0)) - 0.5) * 0.06;
                return s * _WaveScale * 3.0;
            }

            half4 frag(V i) : SV_Target
            {
                float t = _Time.y * _WaveSpeed;
                float3 upv = normalize(i.pw - _GF_PlanetCenter.xyz);
                float3 aa = abs(upv); float2 pp; float3 ax1, ax2;
                if (aa.y >= aa.x && aa.y >= aa.z) { pp = i.pw.xz; ax1 = float3(1, 0, 0); ax2 = float3(0, 0, 1); }
                else if (aa.x >= aa.z) { pp = i.pw.zy; ax1 = float3(0, 0, 1); ax2 = float3(0, 1, 0); }
                else { pp = i.pw.xy; ax1 = float3(1, 0, 0); ax2 = float3(0, 1, 0); }
                float2 slope = WaveSlope(pp, t);
                float3 N = normalize(upv - ax1 * slope.x - ax2 * slope.y);
                float3 V3 = normalize(_WorldSpaceCameraPos - i.pw);

                float2 suv = i.sp.xy / i.sp.w;
                float raw = SampleSceneDepth(suv);
                float sceneEye = LinearEyeDepth(raw, _ZBufferParams);
                float surfEye = LinearEyeDepth(i.pos.z, _ZBufferParams);
                float depth = max(0.0, sceneEye - surfEye);

                float absorb = 1.0 - exp(-depth * _Clarity);
                float3 body = lerp(_ShallowColor.rgb, _DeepColor.rgb, saturate(absorb * 1.3));

                float fres = 0.02 + 0.98 * pow(1.0 - saturate(dot(N, V3)), 5.0);
                float3 R = reflect(-V3, N);
                half4 env = SAMPLE_TEXTURECUBE_LOD(unity_SpecCube0, samplerunity_SpecCube0, R, 1.0);
                float3 sky = DecodeHDREnvironment(env, unity_SpecCube0_HDR);

                Light L = GetMainLight(TransformWorldToShadowCoord(i.pw));
                float3 H = normalize(L.direction + V3);
                float glint = pow(saturate(dot(N, H)), 380.0) * _Glint * L.shadowAttenuation;
                float3 col = lerp(body * (0.35 + 0.65 * saturate(L.color.r + L.color.g)), sky, saturate(fres * 1.1));
                col += L.color * glint * 6.0;

                float foamNoise = vnoise(i.pw.xz * 3.1 + t * 0.4);
                float foam = (1.0 - saturate(depth / _FoamWidth)) * smoothstep(0.25, 0.75, foamNoise + 0.25);
                col = lerp(col, float3(0.9, 0.95, 0.95), saturate(foam) * 0.8);

                float alpha = saturate(0.35 + absorb * 1.2 + fres);
                alpha = max(alpha, foam);
                alpha *= saturate(depth * 6.0);          // soft intersection edge
                col = MixFog(col, i.fog);
                return half4(col, alpha);
            }
            ENDHLSL
        }
    }
}
