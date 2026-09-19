import os
import math
from PIL import Image, ImageDraw, ImageFilter

def create_brand_icon_high_res(size=1024):
    """
    Generates a premium, modern IntegrityFlow shield + checkmark brand icon.
    Created at high resolution and downsampled for pixel-perfect anti-aliasing.
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 1024.0

    # 1. Soft Ambient Shadow
    shadow_offset = int(24 * s)
    shadow_box = [int(64 * s), int((64 + shadow_offset) * s), int(960 * s), int((960 + shadow_offset) * s)]
    draw.rounded_rectangle(shadow_box, radius=int(220 * s), fill=(21, 87, 176, 70))
    img = img.filter(ImageFilter.GaussianBlur(radius=int(12 * s)))
    draw = ImageDraw.Draw(img)

    # 2. Main Squircle Container with Gradient Simulation
    bg_box = [int(64 * s), int(64 * s), int(960 * s), int(960 * s)]
    
    # Layer 1: Base Dark Material Blue #1557D0
    draw.rounded_rectangle(bg_box, radius=int(220 * s), fill=(21, 87, 208, 255))
    
    # Layer 2: Top Gradient Highlight #1A73E8
    top_box = [int(64 * s), int(64 * s), int(960 * s), int(540 * s)]
    draw.rounded_rectangle(top_box, radius=int(220 * s), fill=(26, 115, 232, 220))
    
    # Layer 3: Subtle Glass Inner Border
    draw.rounded_rectangle(bg_box, radius=int(220 * s), outline=(255, 255, 255, 45), width=int(8 * s))

    # 3. Geometric Modern Shield Outline
    # Symmetrical smooth shield
    shield_pts = [
        (int(280 * s), int(260 * s)),  # Top left
        (int(744 * s), int(260 * s)),  # Top right
        (int(744 * s), int(520 * s)),  # Mid right
        (int(512 * s), int(780 * s)),  # Bottom center tip
        (int(280 * s), int(520 * s)),  # Mid left
    ]
    # Subtle shield fill
    draw.polygon(shield_pts, fill=(255, 255, 255, 28))
    
    # Shield border
    shield_border_pts = [
        (int(280 * s), int(260 * s)),
        (int(744 * s), int(260 * s)),
        (int(744 * s), int(520 * s)),
        (int(512 * s), int(780 * s)),
        (int(280 * s), int(520 * s)),
        (int(280 * s), int(260 * s))
    ]
    draw.line(shield_border_pts, fill=(255, 255, 255, 230), width=int(28 * s), joint='round')

    # 4. Bold Dynamic Checkmark (Integrity / Verification)
    check_pts = [
        (int(390 * s), int(500 * s)),  # Check start
        (int(480 * s), int(595 * s)),  # Check valley
        (int(650 * s), int(410 * s))   # Check peak
    ]
    
    # Checkmark shadow
    check_shadow_pts = [(p[0], p[1] + int(6 * s)) for p in check_pts]
    draw.line(check_shadow_pts, fill=(15, 50, 120, 160), width=int(56 * s), joint='round')

    # Main White Checkmark
    draw.line(check_pts, fill=(255, 255, 255, 255), width=int(52 * s), joint='round')
    
    # Smooth rounded end-caps
    r = int(26 * s)
    for pt in check_pts:
        draw.ellipse([pt[0]-r, pt[1]-r, pt[0]+r, pt[1]+r], fill=(255, 255, 255, 255))

    return img

def generate_svg():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a73e8"/>
      <stop offset="100%" stop-color="#1557d0"/>
    </linearGradient>
    <filter id="dropShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#1557d0" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="110" fill="url(#brandGrad)" filter="url(#dropShadow)" stroke="rgba(255,255,255,0.2)" stroke-width="4"/>
  <path d="M 140 130 L 372 130 L 372 260 L 256 390 L 140 260 Z" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="14" stroke-linejoin="round"/>
  <polyline points="195,250 240,298 325,205" fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
</svg>'''

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("Project base directory:", base_dir)

    # Master high-res render
    master_img = create_brand_icon_high_res(1024)

    # Target directories
    dirs = [
        os.path.join(base_dir, "candidate-app", "electron", "assets"),
        os.path.join(base_dir, "candidate-app", "electron", "build"),
        os.path.join(base_dir, "candidate-app", "renderer", "assets"),
        os.path.join(base_dir, "dashboard", "public"),
        os.path.join(base_dir, "dashboard", "src", "assets"),
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)

    # 1. Generate multi-size Windows .ico files
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_paths = [
        os.path.join(base_dir, "candidate-app", "electron", "assets", "icon.ico"),
        os.path.join(base_dir, "candidate-app", "electron", "build", "icon.ico"),
        os.path.join(base_dir, "dashboard", "public", "favicon.ico")
    ]
    
    for path in ico_paths:
        master_img.save(path, format='ICO', sizes=ico_sizes)
        print("Generated ICO:", path)

    # 2. Generate PNG assets
    png_specs = [
        (os.path.join(base_dir, "candidate-app", "electron", "assets", "icon.png"), 512),
        (os.path.join(base_dir, "candidate-app", "renderer", "assets", "icon.png"), 512),
        (os.path.join(base_dir, "dashboard", "public", "favicon.png"), 64),
        (os.path.join(base_dir, "dashboard", "public", "logo192.png"), 192),
        (os.path.join(base_dir, "dashboard", "public", "logo512.png"), 512),
        (os.path.join(base_dir, "dashboard", "src", "assets", "icon.png"), 512),
    ]

    for path, sz in png_specs:
        resized = master_img.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(path, format='PNG')
        print(f"Generated PNG ({sz}x{sz}):", path)

    # 3. Generate SVG assets
    svg_content = generate_svg()
    svg_paths = [
        os.path.join(base_dir, "candidate-app", "renderer", "assets", "logo.svg"),
        os.path.join(base_dir, "dashboard", "public", "logo.svg"),
        os.path.join(base_dir, "dashboard", "src", "assets", "logo.svg")
    ]
    for path in svg_paths:
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg_content)
        print("Generated SVG:", path)

    print("All branding assets generated successfully!")

if __name__ == "__main__":
    main()
