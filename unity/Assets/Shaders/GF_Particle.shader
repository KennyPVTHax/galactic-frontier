// GF/Particle — soft round sprite (procedural, no texture), depth-softened, additive or alpha via _Additive.
Shader "GF/Particle"
{
    Properties
    {
        [Toggle] _Additive ("Additive", Float) = 1
        [HideInInspector] _DstBlend ("Dst blend", Float) = 1
        _Softness ("Soft distance (m)", Float) = 0.6
        _Core ("Hot core", Range(0, 1)) = 0.5
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent+10" }
        Pass
        {
            Name "Unlit"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha [_DstBlend]
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _Additive, _Softness, _Core, _DstBlend;
            CBUFFER_END

            struct A { float4 p : POSITION; float4 c : COLOR; float2 uv : TEXCOORD0; };
            struct V { float4 pos : SV_POSITION; float4 c : COLOR; float2 uv : TEXCOORD0; float4 sp : TEXCOORD1; float fog : TEXCOORD2; };

            V vert(A i)
            {
                V o;
                o.pos = TransformObjectToHClip(i.p.xyz);
                o.c = i.c; o.uv = i.uv; o.sp = ComputeScreenPos(o.pos); o.fog = ComputeFogFactor(o.pos.z);
                return o;
            }

            half4 frag(V i) : SV_Target
            {
                float2 q = i.uv * 2 - 1;
                float r = saturate(1 - dot(q, q));
                float a = r * r * (3 - 2 * r);
                float eyeScene = LinearEyeDepth(SampleSceneDepth(i.sp.xy / i.sp.w), _ZBufferParams);
                float eyeSelf = LinearEyeDepth(i.pos.z, _ZBufferParams);
                a *= saturate((eyeScene - eyeSelf) / max(_Softness, 1e-3));
                float3 col = i.c.rgb;
                col = lerp(col, float3(1, 0.95, 0.8), pow(r, 3) * _Core * (i.c.a));
                float alpha = a * i.c.a;
                col = MixFog(col, i.fog);
                return half4(col * (_Additive > 0.5 ? 1.0 : 1.0), alpha);
            }
            ENDHLSL
        }
    }
}
