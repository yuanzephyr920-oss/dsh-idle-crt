import io
import json
import re

VERSION = '0.2.3'

# package.json
pkg = json.loads(io.open('package.json', encoding='utf-8').read().lstrip('\ufeff'))
pkg['version'] = VERSION
io.open('package.json', 'w', encoding='utf-8', newline='\n').write(
    json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

for path in ('lib/index.js', 'lib/client.js', 'src/client/index.js'):
    text = io.open(path, encoding='utf-8').read()
    new, n = re.subn(r"(\bVERSION\s*=\s*')(\d+\.\d+\.\d+)(')", r"\g<1>" + VERSION + r"\g<3>", text, count=1)
    assert n == 1, f'no VERSION in {path}'
    io.open(path, 'w', encoding='utf-8', newline='\n').write(new)

print('bumped to', VERSION)

