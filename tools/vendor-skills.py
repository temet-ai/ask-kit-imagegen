"""Check vendored source hashes or fetch missing files from the recorded immutable commits."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent / 'vendor'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fetch-missing', action='store_true')
args = parser.parse_args()
lock = json.loads((root/'sources.lock.json').read_text())
errors=[]
count=0
for source in lock['sources']:
    for relative, expected in source['files'].items():
        target=root/source['id']/relative
        if not target.exists() and args.fetch_missing:
            url=f"https://raw.githubusercontent.com/{source['repo']}/{source['commit']}/{relative}"
            payload=urllib.request.urlopen(url, timeout=30).read()
            if hashlib.sha256(payload).hexdigest()!=expected:
                errors.append(f'{target}: upstream checksum mismatch'); continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as out: out.write(payload)
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=expected:
            errors.append(f'{target}: missing or locally modified')
        count+=1
print(json.dumps({'ok':not errors,'files':count,'sources':len(lock['sources']),'errors':errors},indent=2))
raise SystemExit(1 if errors else 0)
