"""Builds a one-file preview of the site for a Claude artifact: styles and scripts inlined,
no document skeleton (the artifact host adds it). The model weights travel as a separate
script (brain.js) next to the page. Usage: bundle_artifact.py <out_dir> [--embed-brain]"""
import base64, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out_dir = sys.argv[1]; embed = '--embed-brain' in sys.argv
os.makedirs(out_dir, exist_ok=True)
read = lambda p: open(os.path.join(ROOT, 'docs', p), encoding='utf-8').read()
html = read('index.html')
body = html[html.index('<!--BODY-BEGIN-->') + len('<!--BODY-BEGIN-->'):html.index('<!--BODY-END-->')].strip()
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com[^"]+)">', html).group(1)
scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
parts = ['<title>Capmon Arena Season 0</title>', '<meta name="claude:viewport-fit-sides" content="cover">',
         f'<link rel="stylesheet" href="{fonts}">', '<style>\n' + read('css/app.css').replace('url(../assets/', 'url(assets/') + '\n</style>', body,
         '<script>window.ARENA_CONFIG = { links: "code", brainUrl: "brain.bin" };</script>']
b64 = base64.b64encode(open(os.path.join(ROOT, 'docs/assets/brain.bin'), 'rb').read()).decode()
if embed:
    parts.append('<script>window.CAPMON_BRAIN_B64 = "' + b64 + '";</script>')
else:
    # The artifact host serves scripts but not raw binary files, so the weights travel as a script.
    open(os.path.join(out_dir, 'brain.js'), 'w').write('window.CAPMON_BRAIN_B64 = "' + b64 + '";\n')
    parts.append('<script src="brain.js"></script>')
for s in scripts:
    js = read(s)
    assert '</script' not in js.lower(), s
    parts.append('<script>\n' + js + '\n</script>')
page = '\n'.join(parts) + '\n'
open(os.path.join(out_dir, 'capmon-arena-season-0.html'), 'w', encoding='utf-8').write(page)
# images travel as files next to the page
import shutil
os.makedirs(os.path.join(out_dir, 'assets'), exist_ok=True)
for f in sorted(os.listdir(os.path.join(ROOT, 'docs/assets'))):
    if f.endswith(('.webp', '.png')): shutil.copy(os.path.join(ROOT, 'docs/assets', f), os.path.join(out_dir, 'assets', f))
# a wrapped copy for local testing, mimicking the host skeleton
wrap = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + page + '</body></html>'
open(os.path.join(out_dir, 'local_test.html'), 'w', encoding='utf-8').write(wrap)
print('page bytes', len(page.encode()), 'scripts', scripts, 'embedded' if embed else 'brain.js beside the page')
