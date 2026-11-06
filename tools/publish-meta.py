import io
import json

path = 'package.json'
pkg = json.loads(io.open(path, encoding='utf-8').read().lstrip('\ufeff'))

pkg.pop('private', None)
pkg['version'] = '0.2.0'
pkg['description'] = 'DSH 待机显像管：无活干且十分钟没有鼠标键盘操作时，页面盖上一块 CRT 板（辉光字 + 循环反色扫掠），点一下或按个键就消失。派生自 dsh-splash-crt。'
pkg['keywords'] = [
    'dsh', 'dsh-plugin', 'deepseek-harness', 'cordis',
    'idle', 'screensaver', 'crt', 'retro', 'webgl', 'shader',
]
pkg['author'] = 'dsh-idle-crt contributors'
pkg['license'] = 'MIT'
pkg['homepage'] = 'https://github.com/yuanzephyr920-oss/dsh-idle-crt#readme'
pkg['repository'] = {
    'type': 'git',
    'url': 'git+https://github.com/yuanzephyr920-oss/dsh-idle-crt.git',
}
pkg['bugs'] = {'url': 'https://github.com/yuanzephyr920-oss/dsh-idle-crt/issues'}
pkg['engines'] = {'node': '>=20'}
pkg['files'] = ['lib', 'src', 'tools', 'cordis.patch.yml', 'README.md', 'LICENSE']
pkg['publishConfig'] = {'registry': 'https://registry.npmjs.org', 'access': 'public'}

io.open(path, 'w', encoding='utf-8', newline='\n').write(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
print('package.json updated')
