"""Takes a few screenshots of the running site for a visual check (phone and desktop)."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')); OUT = os.path.join(ROOT, 'test', 'out', 'shots'); os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8769', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox']); errs = []
        def flow(name, kw, starter):
            page = b.new_context(**kw).new_page(); page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto('http://127.0.0.1:8769/docs/index.html'); page.wait_for_selector('#ob-form'); page.fill('#ob-name', 'Tik'); page.click(f'[data-act="ob-starter"][data-s="{starter}"]'); time.sleep(0.4)
            page.screenshot(path=f'{OUT}/{name}_a_onboard.png'); page.click('button[type=submit]')
            page.click('[data-act="t-set"][data-k="opp"][data-v="Healspike"]'); page.click('[data-act="t-start"]'); page.wait_for_selector('#t-moves .move:not([disabled])')
            page.click('#t-moves .move:nth-child(2)'); time.sleep(0.42); page.screenshot(path=f'{OUT}/{name}_b_teach.png'); time.sleep(3)
            page.click('#tabbar [data-view="arena"]'); page.click('[data-act="play-card"]'); page.wait_for_selector('.why-side', timeout=30000); time.sleep(2.0); page.screenshot(path=f'{OUT}/{name}_c_watch.png')
            page.click('#tabbar [data-view="ladder"]'); time.sleep(0.3); page.screenshot(path=f'{OUT}/{name}_d_ladder.png')
        flow('ph', p.devices['iPhone 13'], 'Rageblaze'); flow('dk', {'viewport': {'width': 1180, 'height': 820}}, 'Tsunami')
        b.close(); print('errors', errs)
    def sheet(names, out, w):
        ims = []
        for n in names:
            im = Image.open(f'{OUT}/{n}.png').convert('RGB'); ims.append(im.resize((w, int(im.height * w / im.width)), Image.LANCZOS))
        H = max(i.height for i in ims); s = Image.new('RGB', (w * len(ims) + 8 * (len(ims) - 1), H), (40, 40, 40)); x = 0
        for i in ims: s.paste(i, (x, 0)); x += w + 8
        s.save(f'{OUT}/{out}', quality=82); print(out, s.size)
    sheet(['ph_a_onboard', 'ph_b_teach', 'ph_c_watch', 'ph_d_ladder'], 'sheet_ph.jpg', 390)
    sheet(['dk_b_teach', 'dk_c_watch'], 'sheet_dk.jpg', 780)
finally:
    srv.terminate()
