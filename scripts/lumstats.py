# Luminance statistics of the 3D area of screenshots (HUD zones excluded): mean, percentiles, crushed-black share.
#   python3 scripts/lumstats.py before-*.jpg after-*.jpg
import sys
from PIL import Image
import numpy as np
# Ignore the HUD zones (top 14%, bottom 22%, left 26% top card) so we measure the 3D scene.
for f in sys.argv[1:]:
    im = np.asarray(Image.open(f).convert("RGB")).astype(float) / 255
    h, w, _ = im.shape
    scene = im[int(h*0.14):int(h*0.78), :, :]
    lin = 0.2126*scene[...,0] + 0.7152*scene[...,1] + 0.0722*scene[...,2]
    print(f"{f.split('/')[-1]:22s} mean luma {lin.mean():.3f} | p5 {np.percentile(lin,5):.3f} p50 {np.percentile(lin,50):.3f} p95 {np.percentile(lin,95):.3f} | crushed(<0.06) {100*(lin<0.06).mean():.1f}% | clipped(>0.95) {100*(lin>0.95).mean():.2f}% | contrast p95/p5 {np.percentile(lin,95)/max(1e-3,np.percentile(lin,5)):.1f}")
