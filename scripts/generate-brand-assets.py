"""
Regenerates the app's icon/splash assets from ../images/logo.png (the transparent, coloured logo).
The original navy backgrounds are replaced by Neotree green. Run:  python3 scripts/generate-brand-assets.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'images', 'logo.png')
OUT = os.path.join(ROOT, 'assets')

GREEN = (46, 125, 91, 255)     # #2E7D5B - replaces the navy background (cream logo reads at ~5:1)
CREAM = (242, 237, 213)        # logo colour used on dark backgrounds in the original assets
os.makedirs(OUT, exist_ok=True)

logo = Image.open(SRC).convert('RGBA')
logo = logo.crop(logo.getbbox())            # tight crop of the artwork


def fit(img, target_w):
    h = round(img.height * target_w / img.width)
    return img.resize((target_w, h), Image.LANCZOS)


def tint(img, rgb):
    """Single-colour version of the logo keeping its alpha."""
    out = Image.new('RGBA', img.size, rgb + (0,))
    out.putalpha(img.getchannel('A'))
    return out


def canvas(size, bg=None):
    return Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))


def centered(bg_size, art, bg=None):
    c = canvas(bg_size, bg)
    c.alpha_composite(art, ((bg_size - art.width) // 2, (bg_size - art.height) // 2))
    return c


# App icon: cream logo on green
centered(1024, fit(tint(logo, CREAM), 640), GREEN).convert('RGB').save(f'{OUT}/icon.png')

# Android adaptive icon (artwork stays inside the 66% safe zone)
centered(1024, fit(tint(logo, CREAM), 560)).save(f'{OUT}/android-icon-foreground.png')
canvas(1024, GREEN).save(f'{OUT}/android-icon-background.png')
centered(1024, fit(tint(logo, (255, 255, 255)), 560)).save(f'{OUT}/android-icon-monochrome.png')

# Splash: coloured logo on white (light) / cream logo on green (dark)
centered(1024, fit(logo, 640)).save(f'{OUT}/splash-icon.png')
centered(1024, fit(tint(logo, CREAM), 640)).save(f'{OUT}/splash-icon-dark.png')

# In-app logo (country selection screen)
fit(logo, 512).save(f'{OUT}/logo.png')

print('ok: brand assets generated')
