"""Quick boot test of the one-file preview bundle (test/out/preview/local_test.html)."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8768', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox']); page = b.new_context(**p.devices['iPhone 13']).new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        t0 = time.time(); page.goto('http://127.0.0.1:8768/test/out/preview/local_test.html'); page.wait_for_selector('#ob-form', timeout=30000)
        page.fill('#ob-name', 'Smoke'); page.click('button[type=submit]'); page.click('[data-act="t-start"]'); page.wait_for_selector('#t-moves .move:not([disabled])'); page.click('#t-moves .move:not([disabled])'); time.sleep(2)
        print('boot ok in', round(time.time() - t0, 1), 's; errors:', errs, '; model:', page.evaluate('CapmonArena.model().id.slice(0,12)'))
        b.close()
finally:
    srv.terminate()
