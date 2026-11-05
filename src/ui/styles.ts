import type { Theme } from "../core/quality";

export function hudCss(t: Theme): string {
  return `
.gf-root{position:absolute;inset:0;overflow:hidden;background:${t.bg};font-family:${t.fontFamily};color:${t.text};-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.gf-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none}
.gf-hud{position:absolute;inset:0;pointer-events:none;--sat:max(env(safe-area-inset-top,0px),var(--gf-inset-top,0px));--sab:max(env(safe-area-inset-bottom,0px),var(--gf-inset-bottom,0px));--sal:max(env(safe-area-inset-left,0px),var(--gf-inset-left,0px));--sar:max(env(safe-area-inset-right,0px),var(--gf-inset-right,0px))}
.gf-frame{position:absolute;top:0;bottom:0;left:var(--frame-x,0px);right:var(--frame-x,0px);pointer-events:none}
.gf-hud *{box-sizing:border-box}
.gf-hud button{font-family:inherit;color:inherit}
.gf-card{background:${t.panel};border:1px solid ${t.border};border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.3)}
.gf-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${t.muted}}
.gf-mission{position:absolute;top:calc(12px + var(--sat));left:calc(12px + var(--sal));width:min(300px,46vw);padding:10px 12px}
.gf-mission h3{margin:2px 0 4px;font-size:15px;font-weight:650;letter-spacing:.02em}
.gf-mission p{margin:0;font-size:12.5px;line-height:1.35;color:${t.text};opacity:.9}
.gf-steps{display:flex;gap:3px;margin:6px 0 2px}
.gf-steps i{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.12)}
.gf-steps i.done{background:${t.accent}}
.gf-steps i.now{background:${t.accent2}}
.gf-prog{margin-top:6px;display:grid;gap:4px}
.gf-prog div{font-size:11.5px;display:flex;justify-content:space-between;gap:8px}
.gf-prog b{font-weight:600;font-variant-numeric:tabular-nums}
.gf-topright{z-index:3;position:absolute;top:calc(12px + var(--sat));right:calc(12px + var(--sar));display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:auto}
.gf-iconrow{display:flex;gap:6px}
.gf-ibtn{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;cursor:pointer;background:${t.panel};border:1px solid ${t.border};font-size:11px;font-weight:600;letter-spacing:.06em}
.gf-ibtn:hover{border-color:${t.accent2}}
.gf-ibtn svg{width:20px;height:20px;stroke:${t.text};fill:none;stroke-width:1.8}
.gf-res{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:46vw}
.gf-chip{display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;font-size:12px;font-variant-numeric:tabular-nums;background:${t.panel};border:1px solid ${t.border}}
.gf-gem{width:9px;height:9px;transform:rotate(45deg);border-radius:2px;box-shadow:0 0 8px currentColor;background:currentColor}
.gf-fps{font-size:11px;line-height:1.45;color:${t.muted};font-variant-numeric:tabular-nums;text-align:right;background:${t.panel};padding:4px 8px;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.gf-compass{position:absolute;top:calc(12px + var(--sat));left:50%;transform:translateX(-50%);width:min(420px,36vw);height:30px;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 15%,#000 85%,transparent)}
.gf-compass .tick{position:absolute;top:4px;transform:translateX(-50%);font-size:11px;font-weight:600;color:${t.muted}}
.gf-compass .tick.card{color:${t.text}}
.gf-compass .mk{position:absolute;top:18px;transform:translateX(-50%);width:8px;height:8px;border-radius:50%}
.gf-compass:after{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:${t.accent2};opacity:.7}
.gf-toasts{position:absolute;top:calc(50px + var(--sat));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;width:min(520px,90vw)}
.gf-toast{padding:7px 14px;font-size:13px;border-radius:8px;animation:gfToast 3.6s ease forwards;text-align:center}
.gf-toast.good{border-color:${t.accent2}}
.gf-toast.warn{border-color:${t.warn};color:${t.warn}}
.gf-toast.bad{border-color:${t.danger};color:${t.danger}}
@keyframes gfToast{0%{opacity:0;transform:translateY(-6px)}8%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
.gf-cross{position:absolute;left:50%;top:50%;width:20px;height:20px;transform:translate(-50%,-50%);border:2px solid rgba(255,255,255,.55);border-radius:50%;transition:border-color .1s,width .1s,height .1s}
.gf-cross i{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#fff;border-radius:50%}
.gf-cross.on{border-color:${t.accent2};width:26px;height:26px}
.gf-target{position:absolute;left:50%;top:calc(50% + 22px);transform:translateX(-50%);padding:5px 10px;font-size:12px;white-space:nowrap;text-align:center}
.gf-target .bar{height:3px;margin-top:4px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
.gf-target .bar i{display:block;height:100%;background:${t.accent2}}
.gf-bottom{position:absolute;left:50%;bottom:calc(14px + var(--sab));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;width:min(520px,94vw)}
.gf-prompt{padding:8px 16px;font-size:14px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
.gf-prompt kbd{display:inline-block;min-width:22px;padding:1px 6px;margin-right:6px;border-radius:5px;border:1px solid ${t.border};background:rgba(255,255,255,.08);font-family:inherit;font-size:12px}
.gf-bars{display:flex;gap:10px;padding:8px 12px;width:100%}
.gf-bar{flex:1;min-width:0}
.gf-bar .track{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:4px}
.gf-bar .fill{height:100%;border-radius:3px;transition:width .08s linear}
.gf-bar.hot .fill{animation:gfBlink .35s steps(2) infinite}
@keyframes gfBlink{50%{opacity:.35}}
.gf-shipbar{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:8px 12px;width:100%;font-variant-numeric:tabular-nums}
.gf-shipbar .v{font-size:17px;font-weight:650}
.gf-shipbar .v small{font-size:11px;color:${t.muted};font-weight:500;margin-left:2px}
.gf-shipstatus{font-size:12px;color:${t.muted};text-align:center;width:100%;padding:0 12px 8px;margin-top:-4px}
.gf-markers{position:absolute;inset:0;overflow:hidden}
.gf-mk{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;white-space:nowrap;text-shadow:0 1px 3px #000}
.gf-mk .dia{width:12px;height:12px;transform:rotate(45deg);border:2px solid currentColor;background:rgba(0,0,0,.35)}
.gf-mk.wp .dia{width:16px;height:16px;background:currentColor;opacity:.85}
.gf-mk .lab{font-weight:600}
.gf-mk .sub{color:${t.muted}}
.gf-panelwrap{z-index:5;position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(3,2,10,.55);pointer-events:auto;padding:calc(16px + var(--sat)) 16px calc(16px + var(--sab))}
.gf-panelwrap.open{display:flex}
.gf-panel{width:min(600px,100%);max-height:100%;overflow:auto;padding:16px 18px 18px}
.gf-panel header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.gf-panel h2{margin:0;font-size:18px;letter-spacing:.03em}
.gf-x{width:34px;height:34px;border-radius:8px;border:1px solid ${t.border};background:transparent;cursor:pointer;font-size:16px}
.gf-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.gf-tab{padding:7px 12px;border-radius:8px;border:1px solid ${t.border};background:transparent;cursor:pointer;font-size:13px}
.gf-tab.on{background:${t.accent};border-color:${t.accent}}
.gf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.gf-slot{padding:10px;border-radius:10px;border:1px solid ${t.border};background:rgba(255,255,255,.03)}
.gf-slot .n{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:6px}
.gf-slot .cap{font-size:11px;color:${t.muted}}
.gf-slot .d{font-size:11.5px;color:${t.muted};margin-top:6px;line-height:1.35}
.gf-up{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center;padding:10px 0;border-top:1px solid rgba(255,255,255,.07)}
.gf-up:first-child{border-top:0}
.gf-up .t{font-weight:600;font-size:14px}
.gf-up .lv{display:inline-flex;gap:3px;margin-left:8px;vertical-align:middle}
.gf-up .lv i{width:12px;height:4px;border-radius:2px;background:rgba(255,255,255,.15)}
.gf-up .lv i.on{background:${t.accent2}}
.gf-up .s{font-size:12px;color:${t.muted};grid-column:1}
.gf-up .c{font-size:12px;grid-column:1}
.gf-up .c.no{color:${t.danger}}
.gf-btn{padding:9px 16px;border-radius:9px;border:1px solid ${t.accent};background:${t.accent};cursor:pointer;font-size:13.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
.gf-btn:disabled{opacity:.4;cursor:default}
.gf-btn.ghost{background:transparent;border-color:${t.border}}
.gf-btn.cy{background:transparent;border-color:${t.accent2};color:${t.accent2}}
.gf-up .gf-btn{grid-row:1 / span 3;grid-column:2}
.gf-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid rgba(255,255,255,.07);font-size:14px}
.gf-row select,.gf-row input[type=range]{font-family:inherit;font-size:13px;background:rgba(255,255,255,.06);color:${t.text};border:1px solid ${t.border};border-radius:7px;padding:5px 8px}
.gf-note{font-size:12px;color:${t.muted};line-height:1.45;margin:10px 0 0}
.gf-title{z-index:6;position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;pointer-events:auto;padding:24px;background:radial-gradient(ellipse 50% 14% at 50% 36%,rgba(255,150,60,.16),transparent 70%),radial-gradient(circle at 50% 36%,rgba(139,92,246,.28),transparent 300px),linear-gradient(180deg,rgba(5,4,11,.35),rgba(5,4,11,.88))}
.gf-title .brand{font-size:12px;letter-spacing:.42em;text-transform:uppercase;color:${t.accent2}}
.gf-title h1{margin:0;font-size:clamp(30px,7vw,58px);letter-spacing:.06em;font-weight:750;text-shadow:0 0 30px rgba(139,92,246,.7)}
.gf-title .sub{color:${t.muted};font-size:14px;margin-top:-6px}
.gf-title .btns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.gf-title .gf-btn{padding:12px 22px;font-size:15px}
.gf-help{display:grid;grid-template-columns:auto auto;gap:4px 14px;font-size:12px;color:${t.muted};margin-top:12px;text-align:left}
.gf-help kbd{color:${t.text};font-family:inherit;font-weight:600}
.gf-legal{position:absolute;bottom:calc(12px + var(--sab));left:0;right:0;font-size:11px;color:${t.muted};padding:0 16px}
.gf-loading{z-index:7;position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;background:${t.bg};pointer-events:auto;font-size:13px;color:${t.muted}}
.gf-loading .track{width:min(260px,70vw);height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
.gf-loading .track i{display:block;height:100%;width:0;background:linear-gradient(90deg,${t.accent},${t.accent2});transition:width .2s}
.gf-hidden{display:none !important}
.gf-hud.title .gf-mission,.gf-hud.title .gf-bottom,.gf-hud.title .gf-compass,.gf-hud.title .gf-topright,.gf-hud.title .gf-cross,.gf-hud.title .gf-markers,.gf-hud.title .gf-touch{display:none !important}
.gf-complete{text-align:center}
.gf-complete .big{font-size:26px;font-weight:700;margin:6px 0}
.gf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:12px 0}
.gf-stats div{padding:8px;border:1px solid ${t.border};border-radius:8px;font-size:12px;color:${t.muted}}
.gf-stats b{display:block;font-size:17px;color:${t.text};margin-top:2px}
.gf-server{padding:10px;border-radius:8px;border:1px dashed ${t.border};font-size:12.5px;color:${t.muted};margin-top:8px}
/* Touch controls */
.gf-touch{z-index:2;position:absolute;inset:0;pointer-events:none}
.gf-joyzone{position:absolute;left:0;bottom:0;width:42%;height:62%;pointer-events:auto;touch-action:none}
.gf-lookzone{position:absolute;right:0;top:calc(110px + var(--sat));width:58%;height:100%;pointer-events:auto;touch-action:none}
.gf-joy{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(10,8,25,.25);left:90px;top:calc(100% - 120px);opacity:.55;pointer-events:none}
.gf-joy.active{opacity:1}
.gf-joy-knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(200,190,255,.55);border:1px solid rgba(255,255,255,.6)}
.gf-tbtns{position:absolute;right:calc(10px + var(--sar));bottom:calc(14px + var(--sab));display:grid;grid-template-columns:repeat(3,62px);grid-auto-rows:54px;gap:8px;pointer-events:none;direction:rtl}
.gf-tbtns.gf-ship{display:none}
.gf-touch[data-mode=ship] .gf-ship{display:grid}
.gf-touch[data-mode=ship] .gf-foot{display:none}
.gf-touch[data-mode=ui]{display:none !important}
.gf-tb{direction:ltr;pointer-events:auto;touch-action:none;border-radius:14px;border:1px solid rgba(255,255,255,.22);background:rgba(12,9,28,.55);color:#fff;font-size:12px;font-weight:600;line-height:1.05}
.gf-tb small{font-size:9px;opacity:.7;font-weight:500}
.gf-tb.on{background:${t.accent};border-color:${t.accent}}
.gf-tb-big{grid-row:span 1}
.gf-tb-fire{background:rgba(46,230,255,.18);border-color:rgba(46,230,255,.5)}
.gf-tb-use{background:rgba(139,92,246,.35)}
.gf-tb.dim{opacity:.35}
.gf-touch-on .gf-bottom{left:auto;right:calc(10px + var(--sar));transform:none;bottom:calc(146px + var(--sab));width:min(210px,52vw);align-items:stretch}
.gf-touch-on .gf-toasts{top:auto;bottom:calc(46% + var(--sab));width:min(420px,80vw)}
.gf-touch-on .gf-toast{font-size:12px;padding:6px 10px}
.gf-touch-on .gf-compass{width:min(300px,32vw)}
.gf-touch-on .gf-bars{flex-direction:column;gap:5px;padding:6px 10px}
.gf-touch-on .gf-shipbar{grid-template-columns:repeat(2,1fr);gap:4px 10px}
.gf-touch-on .gf-prompt{font-size:12.5px;white-space:normal;text-align:center}
.gf-touch-on .gf-prompt kbd{display:none}

/* Rotate-device prompt */
.gf-rotate{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;background:rgba(5,4,11,.94);pointer-events:auto;font-size:14px;color:${t.muted}}
.gf-rotate b{font-size:20px;color:${t.text}}
.gf-phone{width:44px;height:76px;border:3px solid ${t.accent2};border-radius:9px;margin-bottom:10px;animation:gfRot 2.2s ease-in-out infinite}
@keyframes gfRot{0%,20%{transform:rotate(0)}50%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){.gf-phone{animation:none;transform:rotate(-90deg)}}
/* Throttle slider (flight) */
.gf-thr{pointer-events:auto;touch-action:none;display:none;flex-direction:column;align-items:center;gap:4px;border-radius:16px;border:1px solid rgba(255,255,255,.22);background:rgba(12,9,28,.55);padding:8px 0}
.gf-thr-track{position:relative;flex:1;width:38%;border-radius:10px;background:rgba(255,255,255,.1);overflow:hidden}
.gf-thr-fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,${t.accent},${t.accent2})}
.gf-thr-label{font-size:11px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}
.gf-thr.on{border-color:${t.accent2};box-shadow:0 0 0 2px rgba(46,230,255,.25)}
.gf-tb{transition:transform .06s ease,background-color .06s ease}
.gf-tb.on{transform:scale(.93)}
/* Landscape touch layout: thumb arcs at the bottom corners */
.gf-hud.gf-landscape{--u:clamp(44px,11.5vh,66px)}
.gf-hud.gf-landscape .gf-tbtns{display:block;position:absolute;inset:0;grid-template-columns:none;direction:ltr}
.gf-hud.gf-landscape .gf-tbtns.gf-ship{display:none}
.gf-hud.gf-landscape .gf-touch[data-mode=ship] .gf-ship{display:block}
.gf-hud.gf-landscape .gf-touch[data-mode=ship] .gf-foot{display:none}
.gf-hud.gf-landscape .gf-tb,.gf-hud.gf-landscape .gf-thr{position:absolute;border-radius:50%}
.gf-hud.gf-landscape [data-pos]{--s:1.1;width:calc(var(--u)*var(--s));height:calc(var(--u)*var(--s));right:calc(var(--sar) + var(--u)*var(--r));bottom:calc(var(--sab) + var(--u)*var(--b))}
.gf-hud.gf-landscape [data-pos=fire]{--s:1.55;--r:.35;--b:.35;font-size:14px}
.gf-hud.gf-landscape [data-pos=jump]{--s:1.25;--r:2.15;--b:.25}
.gf-hud.gf-landscape [data-pos=use]{--s:1.15;--r:.55;--b:2.15}
.gf-hud.gf-landscape [data-pos=scan]{--s:1.05;--r:2.1;--b:1.75}
.gf-hud.gf-landscape [data-pos=sprint]{--s:1;--r:3.6;--b:.3}
.gf-hud.gf-landscape [data-pos=thr]{--s:1;width:calc(var(--u)*1.15);height:calc(var(--u)*3.6);--r:.35;--b:.35;display:flex;border-radius:18px}
.gf-hud.gf-landscape [data-pos=thrup]{--s:1.08;--r:1.75;--b:2.95;font-size:11px}
.gf-hud.gf-landscape [data-pos=thrdown]{--s:1.08;--r:1.75;--b:1.85;font-size:11px}
.gf-hud.gf-landscape [data-pos=boost]{--s:1.25;--r:1.65;--b:.3}
.gf-hud.gf-landscape [data-pos=up]{--s:1;--r:3.2;--b:1.5}
.gf-hud.gf-landscape [data-pos=down]{--s:1;--r:3.2;--b:.3}
.gf-hud.gf-landscape [data-pos=suse]{--s:1.1;--r:.4;--b:4.2}
.gf-hud.gf-landscape [data-pos=sfire]{--s:1.35;--r:3.05;--b:2.75;font-size:13px}
.gf-hud.gf-landscape [data-pos=starget]{--s:1;--r:4.65;--b:.3;font-size:11px}
.gf-hud.gf-landscape [data-pos=smap]{--s:1;--r:4.65;--b:1.5;font-size:11px}
.gf-hud.gf-landscape .gf-joyzone{width:45%;height:72%}
.gf-hud.gf-landscape .gf-lookzone{width:55%;top:calc(80px + var(--sat))}
.gf-hud.gf-landscape .gf-joy{width:calc(var(--u)*2.1);height:calc(var(--u)*2.1);margin:calc(var(--u)*-1.05) 0 0 calc(var(--u)*-1.05);left:calc(var(--sal) + var(--u)*1.9);top:calc(100% - var(--sab) - var(--u)*1.75)}
.gf-hud.gf-landscape.gf-touch-on .gf-bottom{left:50%;right:auto;transform:translateX(-50%);bottom:calc(10px + var(--sab));width:min(400px,36vw);align-items:center}
.gf-hud.gf-landscape.gf-touch-on .gf-bars{flex-direction:row;gap:10px;padding:6px 10px}
.gf-hud.gf-landscape.gf-touch-on .gf-label{font-size:9px;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gf-hud.gf-landscape.gf-touch-on .gf-shipbar .v{font-size:15px}
.gf-hud.gf-landscape.gf-touch-on .gf-toasts{top:calc(46px + var(--sat));bottom:auto;width:min(420px,44vw)}
.gf-hud.gf-landscape.gf-touch-on .gf-compass{display:block;width:min(260px,26vw)}
.gf-hud.gf-landscape.gf-touch-on .gf-mission{width:min(240px,30vw)}
.gf-hud.gf-landscape.gf-touch-on .gf-mission p{font-size:11px}
.gf-hud.gf-landscape.gf-touch-on .gf-shipbar{grid-template-columns:repeat(4,1fr)}
@media (max-height:430px){.gf-hud.gf-landscape .gf-mission p{display:none}.gf-hud.gf-landscape .gf-mission h3{font-size:13px;margin:0}.gf-hud.gf-landscape .gf-res .gf-chip{font-size:11px;padding:2px 6px}.gf-hud.gf-landscape .gf-ibtn{width:34px;height:34px}}
/* Ultrawide: keep the HUD inside a central frame */
.gf-hud.gf-ultrawide .gf-mission{left:calc(16px + var(--sal))}
@media (max-width:640px){.gf-touch-on .gf-compass{display:none}.gf-mission{width:min(260px,52vw);padding:8px 10px}.gf-mission p{font-size:11.5px}.gf-res .gf-chip{font-size:11px;padding:3px 7px}}
@media (max-height:480px){.gf-mission p{display:none}.gf-help{display:none}}
`;
}
