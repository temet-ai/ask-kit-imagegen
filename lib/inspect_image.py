"""Decode an image and report facts; optionally publish it without overwriting a file."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import warnings


def inspect(filename):
    from PIL import Image
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    with Image.open(filename) as im:
        im.verify()
    with Image.open(filename) as im:
        im.load()  # verify alone does not decode all pixel data
        if im.format not in {'PNG', 'JPEG', 'WEBP', 'GIF'}:
            raise ValueError(f'unsupported image format: {im.format}')
        alpha = im.convert('RGBA').getchannel('A')
        lo, hi = alpha.getextrema()
        result = dict(format=im.format, width=im.width, height=im.height,
                      hasAlpha='A' in im.getbands() or 'transparency' in im.info,
                      hasTransparency=lo < 255, fullyTransparent=hi == 0)
    data = Path(filename).read_bytes()
    return dict(result, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def publish(source, destination):
    from PIL import Image
    info = inspect(source)
    target = Path(destination)
    fmt = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP', '.gif': 'GIF'}.get(target.suffix.lower())
    if not fmt:
        raise ValueError('destination must be PNG, JPEG, WebP or GIF')
    if fmt == 'JPEG' and info['hasTransparency']:
        raise ValueError('JPEG cannot preserve transparency; use a PNG or WebP destination')
    if fmt == 'GIF' and info['format'] != 'GIF':
        raise ValueError('GIF conversion would reduce colours/alpha; use a PNG or WebP destination')
    target.parent.mkdir(parents=True, exist_ok=True)
    for n in range(1, 100_000):
        candidate = target if n == 1 else target.with_name(f'{target.stem}-v{n}{target.suffix}')
        try:
            handle = candidate.open('xb')
        except FileExistsError:
            continue
        try:
            with handle:
                if fmt == info['format']:
                    handle.write(Path(source).read_bytes())
                else:
                    with Image.open(source) as im:
                        im.load()
                        if fmt == 'JPEG':
                            im = im.convert('RGB')
                        im.save(handle, format=fmt, **({'lossless': True} if fmt == 'WEBP' else {}))
            return dict(file=str(candidate.resolve()), validation=inspect(candidate))
        except Exception:
            candidate.unlink(missing_ok=True)
            raise
    raise ValueError('too many existing versions at destination')


def parse_shape(spec):
    """'1024x1024' -> exact pixels; '16:9' or 'square' -> a ratio. Anything else -> None."""
    import re
    from fractions import Fraction
    spec = str(spec or '').strip().lower()
    if spec == 'square':
        spec = '1:1'
    m = re.fullmatch(r'(\d+)\s*[x\u00d7]\s*(\d+)', spec)
    if m:
        return dict(width=int(m[1]), height=int(m[2]), ratio=Fraction(int(m[1]), int(m[2])))
    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)', spec)
    if m:
        return dict(ratio=Fraction(m[1]) / Fraction(m[2]))
    return None


TOLERANCE = 0.03  # further off than this is a composition miss, not rounding: leave it and report it


def conform(source, spec):
    """Crop (centred) and, for exact pixels, resize the image in place to the requested shape.
    Only within TOLERANCE of the requested ratio; the image stays as it is otherwise."""
    from PIL import Image
    shape = parse_shape(spec)
    info = inspect(source)
    w, h = info['width'], info['height']
    if not shape:
        return dict(conformed=False, reason=f'no shape to conform to in {spec!r}', validation=info)
    ratio = shape['ratio']
    off = abs((w / h) / float(ratio) - 1)
    if off > TOLERANCE:
        return dict(conformed=False, reason=f'{w}x{h} is {off:.0%} off {spec}; not cropped, that would cut the composition', validation=info)
    # Largest whole-pixel box of exactly this ratio inside the image.
    p, q = ratio.numerator, ratio.denominator
    k = min(w // p, h // q)
    if k == 0:
        return dict(conformed=False, reason=f'{w}x{h} is too small for an exact {p}:{q} box', validation=info)
    cw, ch = p * k, q * k
    want = (shape.get('width', cw), shape.get('height', ch))
    if (cw, ch) == (w, h) and want == (w, h):
        return dict(conformed=False, reason='already exact', validation=info)
    left, top = (w - cw) // 2, (h - ch) // 2
    with Image.open(source) as im:
        im.load()
        out = im.crop((left, top, left + cw, top + ch))
        if (cw, ch) != want:
            out = out.resize(want, Image.Resampling.LANCZOS)
        out.save(source, format='PNG')
    after = inspect(source)
    return dict(conformed=True, original=[w, h], cropTo=[cw, ch], cropped=[left, top, w - cw - left, h - ch - top],
                resizedTo=list(want) if (cw, ch) != want else None, upscaled=want[0] > cw, validation=after)


def preview(source, destination):
    """Opaque light/dark inspection sheet; never modifies the source or delivery image."""
    from PIL import Image
    inspect(source)
    with Image.open(source) as im:
        rgba = im.convert('RGBA')
        rgba.thumbnail((768, 768))
        sheet = Image.new('RGB', (rgba.width * 2, rgba.height))
        for index, colour in enumerate(('#f4f4f4', '#242424')):
            background = Image.new('RGBA', rgba.size, colour)
            sheet.paste(Image.alpha_composite(background, rgba).convert('RGB'), (index * rgba.width, 0))
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as handle:
        sheet.save(handle, format='PNG')
    return dict(preview=str(target.resolve()), source=str(Path(source).resolve()), note='Inspection only: light and dark backgrounds, scaled to fit. Source unchanged.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', nargs='?')
    parser.add_argument('--publish')
    parser.add_argument('--preview', help='write an opaque light/dark QA sheet to a new PNG; never deliver it as the result')
    parser.add_argument('--conform', help="crop/resize the image in place to WxH, W:H or square (within 3%% of that shape only)")
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        import PIL
        result = dict(pillow=PIL.__version__)
    elif not args.image:
        parser.error('an image path is required')
    else:
        if args.publish and args.preview:
            parser.error('choose --publish or --preview')
        if args.conform:
            print(json.dumps(conform(args.image, args.conform)))
            return
        result = preview(args.image, args.preview) if args.preview else publish(args.image, args.publish) if args.publish else inspect(args.image)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
