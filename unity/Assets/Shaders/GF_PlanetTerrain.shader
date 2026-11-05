// GF/Terrain — slope/height/noise driven PBR splat from Texture2DArrays (CC0 Poly Haven sets),
// two-scale anti-tiling, triplanar rock on cliffs, large-scale colour variation. URP lit + shadows.
// Layers: 0 soil, 1 leaf-litter/mulch, 2 rock, 3 gravel.
Shader "GF/PlanetTerrain"
{
    Properties
    {
        [NoScaleOffset] _DiffArr ("Albedo array", 2DArray) = "" {}
        [NoScaleOffset] _NorArr ("Normal array (GL)", 2DArray) = "" {}
        [NoScaleOffset] _ArmArr ("AO/Rough/Metal array", 2DArray) = "" {}
        _Tint0 ("Soil tint", Color) = (0.62, 0.66, 0.52, 1)
        _Tint1 ("Litter tint", Color) = (0.55, 0.62, 0.45, 1)
        _Tint2 ("Rock tint", Color) = (0.78, 0.76, 0.74, 1)
        _Tint3 ("Gravel tint", Color) = (0.8, 0.78, 0.72, 1)
        _PeakColor ("Peak colour", Color) = (0.9, 0.93, 0.96, 1)
        _Tiles ("Tile size m (soil, litter, rock, gravel)", Vector) = (5, 4, 6, 3.5)
        _WaterLevel ("Water level", Float) = -4
        _PeakRange ("Peak start/end", Vector) = (95, 150, 0, 0)
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
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D_ARRAY(_DiffArr); SAMPLER(sampler_DiffArr);
            TEXTURE2D_ARRAY(_NorArr);
            TEXTURE2D_ARRAY(_ArmArr);

            CBUFFER_START(UnityPerMaterial)
                float4 _Tint0, _Tint1, _Tint2, _Tint3, _PeakColor, _Tiles, _PeakRange;
                float _WaterLevel;
            CBUFFER_END

            float4 _GF_PlanetCenter;   // xyz centre, w radius (set globally)

            struct Attributes { float4 posOS : POSITION; float3 nrmOS : NORMAL; };
            struct Varyings
            {
                float4 posCS : SV_POSITION;
                float3 posWS : TEXCOORD0;
                float3 nrmWS : TEXCOORD1;
                float fog : TEXCOORD2;
            };

            float hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
            float vnoise(float2 p)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(hash21(i), hash21(i + float2(1, 0)), f.x), lerp(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
            }
            float fbm2(float2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.13 + 5.2) * 0.4; }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.posWS = TransformObjectToWorld(IN.posOS.xyz);
                OUT.posCS = TransformWorldToHClip(OUT.posWS);
                OUT.nrmWS = TransformObjectToWorldNormal(IN.nrmOS);
                OUT.fog = ComputeFogFactor(OUT.posCS.z);
                return OUT;
            }

            struct Tex { float3 alb; float3 nrm; float3 arm; };

            // planar (top-down) sample with two scales/rotations blended by low-frequency noise: hides tiling
            Tex Planar(int layer, float2 p, float tile, bool near)
            {
                float2 uv1 = p / tile;
                Tex o;
                float3 a1 = SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uv1, layer).rgb;
                float3 n1 = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uv1, layer).rgb * 2 - 1;
                float3 r1 = SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uv1, layer).rgb;
                if (near)
                {
                    float2 q = float2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
                    float2 uv2 = q / (tile * 1.37) + 0.37;
                    float3 a2 = SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uv2, layer).rgb;
                    float3 n2 = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uv2, layer).rgb * 2 - 1;
                    float3 r2 = SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uv2, layer).rgb;
                    // rotate second normal back into the first frame
                    n2.xy = float2(0.8 * n2.x + 0.6 * n2.y, -0.6 * n2.x + 0.8 * n2.y);
                    float b = smoothstep(0.28, 0.72, vnoise(p * 0.11 + layer * 3.7));
                    o.alb = lerp(a1, a2, b); o.nrm = lerp(n1, n2, b); o.arm = lerp(r1, r2, b);
                }
                else { o.alb = a1; o.nrm = n1; o.arm = r1; }
                return o;
            }

            // triplanar sample of one layer; the returned normal is already in world space
            Tex Tri(int layer, float3 P, float3 N, float tile)
            {
                float3 w = pow(abs(N), 6.0); w /= (w.x + w.y + w.z);
                Tex o; o.alb = 0; o.arm = 0; o.nrm = 0;
                float3 nacc = 0; float used = 0;
                if (w.x > 0.04)
                {
                    float2 uv = P.zy / tile;
                    float3 t = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uv, layer).rgb * 2 - 1;
                    t = float3(t.xy + N.zy, abs(t.z) * N.x); nacc += t.zyx * w.x;
                    o.alb += SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uv, layer).rgb * w.x;
                    o.arm += SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uv, layer).rgb * w.x; used += w.x;
                }
                if (w.y > 0.04)
                {
                    float2 uv = P.xz / tile;
                    float3 t = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uv, layer).rgb * 2 - 1;
                    t = float3(t.xy + N.xz, abs(t.z) * N.y); nacc += t.xzy * w.y;
                    o.alb += SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uv, layer).rgb * w.y;
                    o.arm += SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uv, layer).rgb * w.y; used += w.y;
                }
                if (w.z > 0.04)
                {
                    float2 uv = P.xy / tile;
                    float3 t = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uv, layer).rgb * 2 - 1;
                    t = float3(t.xy + N.xy, abs(t.z) * N.z); nacc += t.xyz * w.z;
                    o.alb += SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uv, layer).rgb * w.z;
                    o.arm += SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uv, layer).rgb * w.z; used += w.z;
                }
                float inv = 1.0 / max(used, 1e-4);
                o.alb *= inv; o.arm *= inv; o.nrm = normalize(nacc + 1e-6);
                return o;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 N = normalize(IN.nrmWS);
                float3 P = IN.posWS;
                float dist = distance(P, _WorldSpaceCameraPos);
                bool near = dist < 70.0;

                // ---------------- weights
                float3 upv = normalize(P - _GF_PlanetCenter.xyz);
                float alt = length(P - _GF_PlanetCenter.xyz) - _GF_PlanetCenter.w;
                float slope = 1.0 - dot(N, upv);
                float macro = fbm2((P.xz + P.yy * 0.37) * 0.012);
                float patch = fbm2((P.xz + P.yy * 0.37) * 0.045 + 11.0);
                float detail = vnoise((P.xz + P.yy * 0.37) * 0.9);
                float hAbove = alt - _WaterLevel;

                float wRock = smoothstep(0.14, 0.30, slope + (macro - 0.5) * 0.10 + (detail - 0.5) * 0.03);
                float wGravel = (1.0 - smoothstep(0.2, 2.6, hAbove + (patch - 0.5) * 2.0)) * (1.0 - wRock);
                float wLitter = smoothstep(0.50, 0.68, patch) * (1.0 - wRock) * (1.0 - wGravel);
                float wSoil = max(0.0, 1.0 - wRock - wGravel - wLitter);
                float sum = wRock + wGravel + wLitter + wSoil + 1e-4;
                wRock /= sum; wGravel /= sum; wLitter /= sum; wSoil /= sum;

                float3 alb = 0, arm = 0, tn = 0; // tn: accumulated world-space normal contribution (xz-swizzled whiteout)
                float3 nAcc = 0;

                if (wSoil > 0.01)
                {
                    Tex t = Tri(0, P, N, _Tiles.x);
                    alb += t.alb * _Tint0.rgb * wSoil; arm += t.arm * wSoil;
                    nAcc += t.nrm * wSoil;
                }
                if (wLitter > 0.01)
                {
                    Tex t = Tri(1, P, N, _Tiles.y);
                    alb += t.alb * _Tint1.rgb * wLitter; arm += t.arm * wLitter;
                    nAcc += t.nrm * wLitter;
                }
                if (wGravel > 0.01)
                {
                    Tex t = Tri(3, P, N, _Tiles.w);
                    alb += t.alb * _Tint3.rgb * wGravel; arm += t.arm * wGravel;
                    nAcc += t.nrm * wGravel;
                }
                if (wRock > 0.01)
                {
                    // triplanar with whiteout normals
                    float3 w = pow(abs(N), 4.0); w /= (w.x + w.y + w.z);
                    float s = _Tiles.z;
                    float2 uvX = P.zy / s, uvY = P.xz / s, uvZ = P.xy / s;
                    float3 aX = SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uvX, 2).rgb;
                    float3 aY = SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uvY, 2).rgb;
                    float3 aZ = SAMPLE_TEXTURE2D_ARRAY(_DiffArr, sampler_DiffArr, uvZ, 2).rgb;
                    float3 rX = SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uvX, 2).rgb;
                    float3 rY = SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uvY, 2).rgb;
                    float3 rZ = SAMPLE_TEXTURE2D_ARRAY(_ArmArr, sampler_DiffArr, uvZ, 2).rgb;
                    float3 nX = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uvX, 2).rgb * 2 - 1;
                    float3 nY = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uvY, 2).rgb * 2 - 1;
                    float3 nZ = SAMPLE_TEXTURE2D_ARRAY(_NorArr, sampler_DiffArr, uvZ, 2).rgb * 2 - 1;
                    nX = float3(nX.xy + N.zy, abs(nX.z) * N.x);
                    nY = float3(nY.xy + N.xz, abs(nY.z) * N.y);
                    nZ = float3(nZ.xy + N.xy, abs(nZ.z) * N.z);
                    float3 nr = normalize(nX.zyx * w.x + nY.xzy * w.y + nZ.xyz * w.z);
                    float3 a = aX * w.x + aY * w.y + aZ * w.z;
                    // altitude: pale frosted rock on the high ridges
                    float peak = smoothstep(_PeakRange.x, _PeakRange.y, alt + (macro - 0.5) * 18.0);
                    float3 rockCol = lerp(_Tint2.rgb, _PeakColor.rgb, peak * 0.85);
                    alb += a * rockCol * wRock;
                    arm += (rX * w.x + rY * w.y + rZ * w.z) * wRock;
                    nAcc += nr * wRock;
                }

                // very low-frequency colour breakup (kills any visible macro repetition)
                alb *= lerp(0.82, 1.12, macro);
                float3 nW = normalize(nAcc + 1e-5);

                SurfaceData sd = (SurfaceData)0;
                sd.albedo = alb;
                sd.metallic = 0;
                sd.specular = 0;
                sd.smoothness = saturate((1.0 - arm.g) * 0.85);
                sd.occlusion = lerp(1.0, arm.r, 0.9);
                sd.alpha = 1;
                sd.normalTS = float3(0, 0, 1);

                InputData id = (InputData)0;
                id.positionWS = P;
                id.normalWS = nW;
                id.viewDirectionWS = normalize(_WorldSpaceCameraPos - P);
                id.shadowCoord = TransformWorldToShadowCoord(P);
                id.fogCoord = IN.fog;
                id.bakedGI = SampleSH(nW);
                id.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(IN.posCS);
                id.shadowMask = half4(1, 1, 1, 1);

                half4 c = UniversalFragmentPBR(id, sd);
                c.rgb = MixFog(c.rgb, IN.fog);
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
            #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 ld = normalize(_LightPosition - pw);
            #else
                float3 ld = _LightDirection;
            #endif
                o.pos = TransformWorldToHClip(ApplyShadowBias(pw, nw, ld));
                o.pos = ApplyShadowClamping(o.pos);
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
