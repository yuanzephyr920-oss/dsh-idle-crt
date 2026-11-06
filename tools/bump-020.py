import io

pairs = [
    ('src/client/index.js', "const VERSION = '0.1.5'", "const VERSION = '0.2.0'"),
    ('lib/index.js', "const VERSION = '0.1.5'", "const VERSION = '0.2.0'"),
    ('lib/client.js', "const VERSION = '0.1.5'", "const VERSION = '0.2.0'"),
    ('package.json', '"version": "0.1.5"', '"version": "0.2.0"'),
]
for path, old, new in pairs:
    text = io.open(path, encoding='utf-8-sig').read()
    assert old in text, (path, old)
    text = text.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(text)
    print('bumped', path)
