"""Export an area's style and references as a portable HTML sheet and PNG contact sheets."""
import base64
import html
import io
import json
from pathlib import Path
import sys
import textwrap
from PIL import Image, ImageDraw, ImageFont


def font(size):
    for name in ['DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/noto/NotoSans-Regular.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def thumbnail(ref, size=(320, 230)):
    background = Image.new('RGB', size, '#eeeeec')
    try:
        with Image.open(ref['file']) as source:
            image = source.convert('RGBA')
            image.thumbnail((size[0]-20, size[1]-20))
            background.paste(image, ((size[0]-image.width)//2, (size[1]-image.height)//2), image)
    except (OSError, ValueError):
        ImageDraw.Draw(background).text((14, 100), 'Source image missing', font=font(18), fill='#222222')
    return background


def main():
    manifest = Path(sys.argv[1])
    data = json.loads(manifest.read_text())
    directory = manifest.parent
    escape = lambda value: html.escape(str(value), quote=True)
    style = data['style']
    refs = data['references']
    cards = []
    pages = []
    for offset in range(0, max(1, len(refs)), 9):
        subset = refs[offset:offset+9]
        rows = max(1, (len(subset)+2)//3)
        page = Image.new('RGB', (1080, 110+rows*330), '#fafaf8')
        draw = ImageDraw.Draw(page)
        draw.text((24, 20), data['title'], font=font(28), fill='#222222')
        first = offset+1 if subset else 0
        draw.text((24, 62), f"Reference sheet | revision {data['revision']} | {first}-{offset+len(subset)} of {len(refs)}", font=font(16), fill='#555555')
        if not subset:
            draw.text((24, 130), 'No references in this selection yet.', font=font(20), fill='#222222')
        for index, ref in enumerate(subset):
            x, y = 24+(index%3)*354, 104+(index//3)*330
            thumb = thumbnail(ref)
            page.paste(thumb, (x,y))
            title_lines = textwrap.wrap(ref['title'], width=32)[:2]
            for line_index, line in enumerate(title_lines):
                draw.text((x,y+240+line_index*21), line, font=font(17), fill='#222222')
            draw.text((x,y+286), f"{ref['status']} | {ref['role']} | {ref['id'][-8:]}", font=font(14), fill='#555555')
            buf=io.BytesIO(); thumb.save(buf,format='PNG')
            src='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
            feedback=''.join(f"<li>{escape(f['verdict'])}: {escape(f['note'])}</li>" for f in ref.get('feedback',[]))
            source = escape(ref.get('source') or ref.get('origin') or 'Generated in this library')
            cards.append(f"<article><img alt='{escape(ref['title'])}' src='{src}'><h2>{escape(ref['title'])}</h2><p>{escape(ref['status'])} · {escape(ref['role'])}</p><p>{escape(ref.get('notes',''))}</p><ul>{feedback}</ul><small>{escape(ref['id'])}<br>Source: {source}<br>SHA-256: {escape(ref['validation']['sha256'])}</small></article>")
        target=directory/f'references-{len(pages)+1}.png'
        with target.open('xb') as out: page.save(out,format='PNG')
        pages.append(str(target.resolve()))
    list_items=lambda values: ''.join(f'<li>{escape(v)}</li>' for v in values)
    document=f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(data['title'])}</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fafaf8;margin:24px;max-width:1400px}}h1{{font-size:26px;margin-bottom:4px}}h2{{font-size:17px;margin:8px 0}}p{{white-space:pre-wrap;margin:8px 0}}.style{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;border-block:1px solid #ccc;margin:20px 0;padding:16px 0}}.refs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}}article{{border-bottom:1px solid #ccc;padding-bottom:16px;overflow-wrap:anywhere}}img{{display:block;width:100%;max-height:250px;object-fit:contain;background:#eee}}small{{color:#555}}ul{{padding-left:20px}}</style>
<h1>{escape(data['title'])}</h1><p>{escape(data['description'])}</p><small>Area {escape(data['name'])} · revision {data['revision']} · workflow {escape(style['workflow'])}</small>
<div class="style"><section><h2>Style guidance</h2><p>{escape(style['guidance']) or 'No style guidance recorded yet.'}</p></section><section><h2>Keep</h2><ul>{list_items(style['keep'])}</ul></section><section><h2>Avoid</h2><ul>{list_items(style['avoid'])}</ul></section></div>
<div class="refs">{''.join(cards) or '<p>No references in this selection yet.</p>'}</div></html>"""
    target=directory/'index.html'
    with target.open('x') as out: out.write(document)
    print(json.dumps({'html':str(target.resolve()),'sheets':pages,'references':len(refs)}))


if __name__=='__main__':
    main()
