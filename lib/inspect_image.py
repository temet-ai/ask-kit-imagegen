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
        result = preview(args.image, args.preview) if args.preview else publish(args.image, args.publish) if args.publish else inspect(args.image)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': str(exc)}))
        sys.exit(1)
