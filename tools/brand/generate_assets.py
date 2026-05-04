"""Generate reproducible Inspyro brand assets from the approved PNG master."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[2]
BRAND_DIR = ROOT / "assets" / "brand"
PNG_DIR = BRAND_DIR / "png"
SOURCE_LOGO = BRAND_DIR / "inspyro-logo-source.png"
MARK_MASTER = BRAND_DIR / "inspyro-mark.png"
LOGO_MASTER = BRAND_DIR / "inspyro-logo.png"
MARK_LIGHT_MASTER = BRAND_DIR / "inspyro-mark-light.png"
LOGO_LIGHT_MASTER = BRAND_DIR / "inspyro-logo-light.png"
APP_ICON_MASTER = BRAND_DIR / "inspyro-app-icon.png"
FRONTEND_FAVICON = ROOT / "frontend" / "public" / "favicon.png"
FRONTEND_PUBLIC_BRAND = ROOT / "frontend" / "public" / "brand"
FRONTEND_SRC_BRAND = ROOT / "frontend" / "src" / "assets" / "brand"
FRONTEND_SRC_MARK = FRONTEND_SRC_BRAND / "inspyro-mark.png"
FRONTEND_SRC_LOGO = FRONTEND_SRC_BRAND / "inspyro-logo.png"
FRONTEND_SRC_MARK_LIGHT = FRONTEND_SRC_BRAND / "inspyro-mark-light.png"
FRONTEND_SRC_LOGO_LIGHT = FRONTEND_SRC_BRAND / "inspyro-logo-light.png"
DESKTOP_ASSETS = ROOT / "desktop" / "assets"
WORD_ASSETS = ROOT / "word-addin" / "assets"
SIZES = [16, 32, 48, 64, 80, 128, 256, 512]
LOGO_WIDTHS = [512, 1024]
ICO_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
WHITE = (255, 255, 255, 255)
TRANSPARENT = (255, 255, 255, 0)
PERLA_DARK = (218, 230, 224)
PERLA_LIGHT = (255, 252, 240)
TILE_BG = (13, 17, 23, 255)
TILE_BORDER = (34, 197, 94, 132)

OBSOLETE_ASSETS = [
    BRAND_DIR / "inspyro-mark.svg",
    BRAND_DIR / "inspyro-mark-mono.svg",
    BRAND_DIR / "inspyro-logo.svg",
    ROOT / "frontend" / "public" / "favicon.svg",
    FRONTEND_SRC_BRAND / "inspyro-mark.svg",
    DESKTOP_ASSETS / "inspyro-mark.svg",
    DESKTOP_ASSETS / "inspyro-logo.svg",
]


def ensure_inputs() -> None:
    if not SOURCE_LOGO.exists():
        raise FileNotFoundError(f"Missing PNG master: {SOURCE_LOGO}")


def non_white_mask(image: Image.Image, threshold: int = 18) -> Image.Image:
    rgb = image.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white).convert("L")
    return diff.point(lambda value: 255 if value > threshold else 0)


def horizontal_bands(mask: Image.Image) -> list[tuple[int, int]]:
    width, height = mask.size
    pixels = mask.load()
    row_threshold = max(8, int(width * 0.005))
    rows: list[int] = []
    for y in range(height):
        count = 0
        for x in range(width):
            if pixels[x, y]:
                count += 1
        rows.append(count)

    bands: list[tuple[int, int]] = []
    start: int | None = None
    for y, count in enumerate(rows):
        if count >= row_threshold:
            if start is None:
                start = y
        elif start is not None:
            bands.append((start, y - 1))
            start = None
    if start is not None:
        bands.append((start, height - 1))

    merged: list[tuple[int, int]] = []
    for band in bands:
        if merged and band[0] - merged[-1][1] <= 8:
            merged[-1] = (merged[-1][0], band[1])
        else:
            merged.append(band)
    return merged


def expand_bbox(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    pad_ratio: float,
    *,
    square: bool = False,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    image_width, image_height = image_size

    if square:
        side = int(round(max(width, height) * (1 + 2 * pad_ratio)))
        center_x = (left + right) / 2
        center_y = (top + bottom) / 2
        left = int(round(center_x - side / 2))
        top = int(round(center_y - side / 2))
        right = left + side
        bottom = top + side
    else:
        pad = int(round(max(width, height) * pad_ratio))
        left -= pad
        top -= pad
        right += pad
        bottom += pad

    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > image_width:
        left -= right - image_width
        right = image_width
    if bottom > image_height:
        top -= bottom - image_height
        bottom = image_height

    return max(0, left), max(0, top), min(image_width, right), min(image_height, bottom)


def crop_source(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    flattened = Image.alpha_composite(Image.new("RGBA", source.size, WHITE), source.convert("RGBA"))
    mask = non_white_mask(flattened)
    full_bbox = mask.getbbox()
    if full_bbox is None:
        raise RuntimeError("The source logo does not contain visible non-white pixels.")

    bands = horizontal_bands(mask)
    if len(bands) >= 2:
        mark_y1, mark_y2 = bands[0]
    else:
        mark_y1 = full_bbox[1]
        mark_y2 = int(full_bbox[1] + (full_bbox[3] - full_bbox[1]) * 0.74)

    mark_mask = mask.crop((0, mark_y1, mask.width, mark_y2 + 1))
    mark_local_bbox = mark_mask.getbbox()
    if mark_local_bbox is None:
        raise RuntimeError("Could not isolate the symbol from the PNG master.")
    mark_bbox = (
        mark_local_bbox[0],
        mark_local_bbox[1] + mark_y1,
        mark_local_bbox[2],
        mark_local_bbox[3] + mark_y1,
    )

    logo_bbox = expand_bbox(full_bbox, flattened.size, 0.06)
    mark_bbox = expand_bbox(mark_bbox, flattened.size, 0.07, square=True)
    return flattened.crop(mark_bbox), flattened.crop(logo_bbox)


def remove_light_background(source: Image.Image, threshold: int = 20, feather: int = 44) -> Image.Image:
    image = source.convert("RGBA")
    output = Image.new("RGBA", image.size, TRANSPARENT)
    pixels = image.load()
    out_pixels = output.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            distance = max(abs(255 - red), abs(255 - green), abs(255 - blue))
            if distance <= threshold:
                continue
            matte = min(255, max(0, round((distance - threshold) * 255 / max(1, feather - threshold))))
            out_pixels[x, y] = (red, green, blue, round(alpha * matte / 255))
    return output


def remove_small_alpha_components(source: Image.Image, min_pixels: int = 420) -> Image.Image:
    image = source.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    components_to_clear: list[list[tuple[int, int]]] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if visited[start_index] or pixels[start_x, start_y][3] == 0:
                continue

            stack = [(start_x, start_y)]
            visited[start_index] = 1
            component: list[tuple[int, int]] = []
            while stack:
                x, y = stack.pop()
                component.append((x, y))
                for ny in range(max(0, y - 1), min(height, y + 2)):
                    for nx in range(max(0, x - 1), min(width, x + 2)):
                        index = ny * width + nx
                        if visited[index] or pixels[nx, ny][3] == 0:
                            continue
                        visited[index] = 1
                        stack.append((nx, ny))

            if len(component) < min_pixels:
                components_to_clear.append(component)

    if not components_to_clear:
        return image

    cleaned = image.copy()
    cleaned_pixels = cleaned.load()
    for component in components_to_clear:
        for x, y in component:
            red, green, blue, _alpha = cleaned_pixels[x, y]
            cleaned_pixels[x, y] = (red, green, blue, 0)
    return cleaned


def light_variant(source: Image.Image) -> Image.Image:
    cutout = remove_small_alpha_components(remove_light_background(source))
    output = Image.new("RGBA", cutout.size, TRANSPARENT)
    pixels = cutout.load()
    out_pixels = output.load()

    for y in range(cutout.height):
        for x in range(cutout.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue

            luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            is_green = green > red * 1.18 and green > blue * 1.06 and green > 70
            is_gold = red > 120 and green > 78 and blue < 95 and red >= green
            is_dark_graphite = luminance < 170 and not is_green and not is_gold

            if is_dark_graphite:
                tone = max(0.0, min(1.0, luminance / 170))
                red = round(PERLA_DARK[0] + (PERLA_LIGHT[0] - PERLA_DARK[0]) * tone)
                green = round(PERLA_DARK[1] + (PERLA_LIGHT[1] - PERLA_DARK[1]) * tone)
                blue = round(PERLA_DARK[2] + (PERLA_LIGHT[2] - PERLA_DARK[2]) * tone)
            elif is_green:
                red = min(255, round(red * 1.04))
                green = min(255, round(green * 1.08))
                blue = min(255, round(blue * 1.04))
            elif is_gold:
                red = min(255, round(red * 1.08))
                green = min(255, round(green * 1.04))

            out_pixels[x, y] = (red, green, blue, alpha)

    return output


def square_png(source: Image.Image, size: int, background: tuple[int, int, int, int] = WHITE) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    fitted = ImageOps.contain(source, (size, size), Image.Resampling.LANCZOS)
    offset = ((size - fitted.width) // 2, (size - fitted.height) // 2)
    canvas.alpha_composite(fitted, offset)
    return canvas


def app_icon_tile(mark: Image.Image, size: int = 512) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    tile = Image.new("RGBA", (size, size), TILE_BG)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = round(size * 0.18)
    inset = round(size * 0.035)
    draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=255)
    canvas.alpha_composite(Image.composite(tile, Image.new("RGBA", (size, size), TRANSPARENT), mask))

    glow = Image.new("RGBA", (size, size), TRANSPARENT)
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(
        (inset + 2, inset + 2, size - inset - 2, size - inset - 2),
        radius=radius,
        outline=TILE_BORDER,
        width=max(2, round(size * 0.012)),
    )
    canvas.alpha_composite(glow)

    mark_size = round(size * 0.78)
    fitted = ImageOps.contain(mark, (mark_size, mark_size), Image.Resampling.LANCZOS)
    offset = ((size - fitted.width) // 2, (size - fitted.height) // 2)
    canvas.alpha_composite(fitted, offset)
    return canvas


def resize_width(source: Image.Image, width: int) -> Image.Image:
    height = max(1, round(source.height * (width / source.width)))
    return source.resize((width, height), Image.Resampling.LANCZOS)


def validate_png(path: Path, size: tuple[int, int] | int) -> None:
    with Image.open(path) as image:
        expected = (size, size) if isinstance(size, int) else size
        if image.size != expected:
            raise RuntimeError(f"{path} has size {image.size}, expected {expected}")


def main() -> int:
    ensure_inputs()
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    FRONTEND_PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    FRONTEND_SRC_BRAND.mkdir(parents=True, exist_ok=True)
    DESKTOP_ASSETS.mkdir(parents=True, exist_ok=True)
    WORD_ASSETS.mkdir(parents=True, exist_ok=True)

    for path in OBSOLETE_ASSETS:
        path.unlink(missing_ok=True)

    with Image.open(SOURCE_LOGO) as source:
        mark_master, logo_master = crop_source(source)

    mark_light_master = light_variant(mark_master)
    logo_light_master = light_variant(logo_master)
    app_icon_master = app_icon_tile(mark_light_master, 512)

    mark_master.save(MARK_MASTER)
    logo_master.save(LOGO_MASTER)
    mark_light_master.save(MARK_LIGHT_MASTER)
    logo_light_master.save(LOGO_LIGHT_MASTER)
    app_icon_master.save(APP_ICON_MASTER)

    mark_outputs = {}
    mark_light_outputs = {}
    app_icon_outputs = {}
    for size in SIZES:
        output = PNG_DIR / f"inspyro-mark-{size}.png"
        square_png(mark_master, size).save(output)
        validate_png(output, size)
        mark_outputs[size] = output

        light_output = PNG_DIR / f"inspyro-mark-light-{size}.png"
        square_png(mark_light_master, size, TRANSPARENT).save(light_output)
        validate_png(light_output, size)
        mark_light_outputs[size] = light_output

        icon_output = PNG_DIR / f"inspyro-app-icon-{size}.png"
        square_png(app_icon_master, size, TRANSPARENT).save(icon_output)
        validate_png(icon_output, size)
        app_icon_outputs[size] = icon_output

    for width in LOGO_WIDTHS:
        output = PNG_DIR / f"inspyro-logo-{width}.png"
        resized = resize_width(logo_master, width)
        resized.save(output)
        validate_png(output, resized.size)

        light_output = PNG_DIR / f"inspyro-logo-light-{width}.png"
        light_resized = resize_width(logo_light_master, width)
        light_resized.save(light_output)
        validate_png(light_output, light_resized.size)

    shutil.copyfile(mark_outputs[64], FRONTEND_FAVICON)
    shutil.copyfile(mark_outputs[128], FRONTEND_PUBLIC_BRAND / "inspyro-mark-128.png")
    shutil.copyfile(mark_outputs[512], FRONTEND_PUBLIC_BRAND / "inspyro-mark-512.png")
    shutil.copyfile(mark_light_outputs[128], FRONTEND_PUBLIC_BRAND / "inspyro-mark-light-128.png")
    shutil.copyfile(mark_light_outputs[512], FRONTEND_PUBLIC_BRAND / "inspyro-mark-light-512.png")
    shutil.copyfile(LOGO_MASTER, FRONTEND_PUBLIC_BRAND / "inspyro-logo.png")
    shutil.copyfile(LOGO_LIGHT_MASTER, FRONTEND_PUBLIC_BRAND / "inspyro-logo-light.png")
    shutil.copyfile(MARK_MASTER, FRONTEND_SRC_MARK)
    shutil.copyfile(LOGO_MASTER, FRONTEND_SRC_LOGO)
    shutil.copyfile(MARK_LIGHT_MASTER, FRONTEND_SRC_MARK_LIGHT)
    shutil.copyfile(LOGO_LIGHT_MASTER, FRONTEND_SRC_LOGO_LIGHT)

    shutil.copyfile(MARK_MASTER, DESKTOP_ASSETS / "inspyro-mark.png")
    shutil.copyfile(LOGO_MASTER, DESKTOP_ASSETS / "inspyro-logo.png")
    shutil.copyfile(MARK_LIGHT_MASTER, DESKTOP_ASSETS / "inspyro-mark-light.png")
    shutil.copyfile(LOGO_LIGHT_MASTER, DESKTOP_ASSETS / "inspyro-logo-light.png")
    shutil.copyfile(APP_ICON_MASTER, DESKTOP_ASSETS / "inspyro-app-icon.png")
    shutil.copyfile(app_icon_outputs[256], DESKTOP_ASSETS / "icon.png")
    shutil.copyfile(app_icon_outputs[512], DESKTOP_ASSETS / "icon-512.png")
    shutil.copyfile(mark_outputs[16], WORD_ASSETS / "icon-16.png")
    shutil.copyfile(mark_outputs[32], WORD_ASSETS / "icon-32.png")
    shutil.copyfile(mark_outputs[80], WORD_ASSETS / "icon-80.png")

    with Image.open(app_icon_outputs[512]) as source:
        source.save(DESKTOP_ASSETS / "icon.ico", sizes=ICO_SIZES)

    for path in [
        FRONTEND_FAVICON,
        FRONTEND_PUBLIC_BRAND / "inspyro-mark-128.png",
        FRONTEND_PUBLIC_BRAND / "inspyro-mark-light-128.png",
        FRONTEND_SRC_MARK,
        FRONTEND_SRC_MARK_LIGHT,
        DESKTOP_ASSETS / "inspyro-mark.png",
        DESKTOP_ASSETS / "inspyro-mark-light.png",
        DESKTOP_ASSETS / "inspyro-app-icon.png",
        DESKTOP_ASSETS / "inspyro-logo.png",
        DESKTOP_ASSETS / "icon.ico",
        DESKTOP_ASSETS / "icon.png",
        WORD_ASSETS / "icon-16.png",
        WORD_ASSETS / "icon-32.png",
        WORD_ASSETS / "icon-80.png",
    ]:
        if not path.exists() or path.stat().st_size == 0:
            raise RuntimeError(f"Expected generated asset missing or empty: {path}")

    print("Generated Inspyro brand assets:")
    print(f"- {SOURCE_LOGO.relative_to(ROOT)}")
    print(f"- {MARK_MASTER.relative_to(ROOT)}")
    print(f"- {LOGO_MASTER.relative_to(ROOT)}")
    print(f"- {MARK_LIGHT_MASTER.relative_to(ROOT)}")
    print(f"- {APP_ICON_MASTER.relative_to(ROOT)}")
    print(f"- {FRONTEND_FAVICON.relative_to(ROOT)}")
    print(f"- {FRONTEND_SRC_MARK.relative_to(ROOT)}")
    print(f"- {DESKTOP_ASSETS.relative_to(ROOT) / 'icon.ico'}")
    print(f"- {WORD_ASSETS.relative_to(ROOT) / 'icon-16.png'}")
    print(f"- {WORD_ASSETS.relative_to(ROOT) / 'icon-32.png'}")
    print(f"- {WORD_ASSETS.relative_to(ROOT) / 'icon-80.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
