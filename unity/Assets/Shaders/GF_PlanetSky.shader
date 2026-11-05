// GF/PlanetSky - gradient sky aligned to the LOCAL up of the player, so the horizon is correct anywhere on the globe.
Shader "GF/PlanetSky"
{
    Properties
    {
        _Zenith ("Zenith", Color) = (0.10, 0.30, 0.62, 1)
        _Horizon ("Horizon", Color) = (0.66, 0.84, 0.90, 1)
        _GroundCol ("Below horizon", Color) = (0.14, 0.20, 0.15, 1)
        _SunColor ("Sun", Color) = (1.0, 0.95, 0.82, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" "RenderPipeline" = "UniversalPipeline" }
        Cull Off ZWrite Off
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
                float4 _Zenith, _Horizon, _GroundCol, _SunColor;
            CBUFFER_END
            float4 _GF_Up, _GF_SunDir;
            struct A { float4 p : POSITION; };
            struct V { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; };
            V vert(A i) { V o; o.pos = TransformObjectToHClip(i.p.xyz); o.dir = i.p.xyz; return o; }
            half4 frag(V i) : SV_Target
            {
                float3 v = normalize(i.dir);
                float h = dot(v, normalize(_GF_Up.xyz));
                float sunD = saturate(dot(v, normalize(_GF_SunDir.xyz)));
                float3 col = lerp(_Horizon.rgb, _Zenith.rgb, pow(saturate(h), 0.55));
                col += _Horizon.rgb * pow(1.0 - saturate(abs(h)), 5.0) * 0.22;
                col = lerp(col, _GroundCol.rgb, saturate(-h * 4.0));
                col += _SunColor.rgb * (pow(sunD, 2500.0) * 40.0 + pow(sunD, 80.0) * 0.45 + pow(sunD, 7.0) * 0.12);
                float atmo = saturate(_GF_Up.w);
                float3 sp = floor(v * 420.0);
                float h1 = frac(sin(dot(sp, float3(12.9898, 78.233, 37.719))) * 43758.5453);
                float star = step(0.9965, h1) * (0.4 + 0.6 * frac(h1 * 91.7));
                float3 space = float3(0.004, 0.006, 0.012) + star.xxx * float3(0.9, 0.95, 1.0);
                col = lerp(space, col, atmo);
                col += _SunColor.rgb * pow(sunD, 2500.0) * 40.0 * (1.0 - atmo);
                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
