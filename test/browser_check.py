"""Loads the engine in headless Chromium and checks it reproduces the Node hashes."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = 8765
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1.0)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        out = {}
        for name, kw in [('desktop', {}), ('phone', p.devices['Pixel 7']), ('slow phone (4x CPU throttle)', p.devices['Pixel 7'])]:
            ctx = b.new_context(**kw); page = ctx.new_page()
            errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
            if 'slow' in name:
                cdp = ctx.new_cdp_session(page); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
            page.goto(f'http://127.0.0.1:{PORT}/test/browser_check.html')
            page.wait_for_function('window.__result', timeout=120000)
            r = page.evaluate('window.__result'); r['pageErrors'] = errors; r.pop('ua', None); out[name] = r; ctx.close()
        b.close()
    print(json.dumps(out, indent=1))
    ok = all(v.get('ok') and not v['pageErrors'] for v in out.values())
    json.dump(out, open(os.path.join(ROOT, 'test', 'out', 'browser_check.json'), 'w'), indent=1)
    print('RESULT:', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
finally:
    srv.terminate()
