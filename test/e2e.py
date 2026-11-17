"""End-to-end run of the site in headless Chromium at phone and desktop sizes.
Walks the whole flow: create a brain, teach, ranked matches, watch, brain page, ladder,
challenge by code, replay check, tamper check, reload. Fails on any page error."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
def tap(page, sel):
    """Clicks like a finger would: bring the element to the middle of the screen, then press its centre.
    (Playwright's own click can stall on pages that animate all the time.)"""
    el = page.wait_for_selector(sel, state='visible', timeout=30000)
    el.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest'})")
    b = el.bounding_box(); page.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = 8766
URL = sys.argv[1] if len(sys.argv) > 1 else f'http://127.0.0.1:{PORT}/docs/index.html'
SHOTS = os.path.join(ROOT, 'test', 'out', 'shots')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
results = {}
def run(name, kw, p, b):
    ctx = b.new_context(**kw); page = ctx.new_page(); errors = []; steps = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    def ok(label, cond, detail=''):
        steps.append({'step': label, 'ok': bool(cond), 'detail': str(detail)[:200]})
    def shot(n): page.screenshot(path=os.path.join(SHOTS, f'{name}_{n}.png'))
    page.goto(URL); page.wait_for_selector('#ob-form', timeout=30000)
    ok('onboarding shows', True); shot('1_onboarding')
    tap(page, 'button[type=submit]'); ok('empty name is refused', page.is_visible('#ob-err'))
    page.fill('#ob-name', 'Tik <b>'); tap(page, '[data-act="ob-starter"][data-s="Tsunami"]')
    ok('name kept when picking starter', page.input_value('#ob-name') == 'Tik <b>')
    tap(page, 'button[type=submit]'); page.wait_for_selector('[data-act="t-start"]')
    ok('lands on teach', 'teach' in page.inner_text('h1').lower())
    # teach one full battle
    tap(page, '[data-act="t-start"]'); page.wait_for_selector('#t-moves')
    rounds = 0
    while True:
        page.wait_for_function("document.querySelector('.result') || document.querySelector('#t-moves .move:not([disabled])')", timeout=20000)
        if page.query_selector('.result'): break
        btns = page.query_selector_all('#t-moves .move:not([disabled])')
        el = btns[rounds % len(btns)]; el.evaluate("e => e.scrollIntoView({block: 'center'})"); bb = el.bounding_box(); page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); rounds += 1
        if rounds == 2: shot('2_teach')
        if rounds > 60: break
    ok('teach battle finishes', page.query_selector('.result') is not None, f'{rounds} rounds')
    st = page.evaluate('CapmonArena.state()')
    ok('moves were recorded', st['teach']['moves'] == rounds and st['teach']['battles'] == 1, st['teach'])
    ok('name is stored cleaned', st['name'] == 'Tik <b>')
    ok('no raw html from the name', page.evaluate("!document.querySelector('#view h2 b')") and '<b>' in page.inner_text('#view h2').lower())
    # leave mid-battle and come back
    tap(page, '[data-act="t-again"]'); tap(page, '[data-act="t-start"]'); page.wait_for_selector('#t-moves .move:not([disabled])')
    tap(page, '#t-moves .move:not([disabled])'); tap(page, '#tabbar [data-view="ladder"]'); tap(page, '#tabbar [data-view="teach"]')
    page.wait_for_function("document.querySelector('.result') || document.querySelector('#t-moves .move:not([disabled])')", timeout=8000)
    ok('battle resumes after leaving', True)
    # ranked card
    tap(page, '#tabbar [data-view="arena"]'); page.wait_for_selector('[data-act="play-card"]'); shot('3_arena')
    tap(page, '[data-act="play-card"]'); page.wait_for_selector('#stage', timeout=30000)
    page.wait_for_selector('.why-side', timeout=15000); time.sleep(1.2); shot('4_watch')
    ok('why panel shows both sides', len(page.query_selector_all('.why-side')) == 2)
    for i in range(3):
        tap(page, '[data-act="w-skip-all"]'); page.wait_for_selector('.result .score', timeout=20000)
        if i == 0: shot('5_result')
        if page.query_selector('[data-act="watch-next"]'): tap(page, '[data-act="watch-next"]'); page.wait_for_selector('[data-act="w-skip-all"]')
        else: break
    st = page.evaluate('CapmonArena.state()')
    day = sorted(st['days'].keys())[-1]; done = st['days'][day]['done']
    ok('three ranked matches stored', len([d for d in done if d]) == 3 and st['ranked']['played'] == 3, st['ranked'])
    ok('all three seen after watching', all(d['seen'] for d in done))
    ok('rating follows the records', st['rating'] == done[2]['r1'] and done[0]['r0'] == 1000, st['rating'])
    tap(page, '.result [data-act="nav"]'); page.wait_for_selector('.item'); ok('card shows done', 'done' in page.inner_text('#view'))
    # brain, ladder
    tap(page, '#tabbar [data-view="brain"]'); page.wait_for_selector('.bgrid'); tap(page, '.cell.taught'); shot('6_brain')
    ok('brain grid has 36 cells', len(page.query_selector_all('.cell')) == 36)
    ok('brain code shown', page.input_value('#brain-code').startswith('b1.'))
    tap(page, '#tabbar [data-view="ladder"]'); ok('ladder has 11 rows', len(page.query_selector_all('.item')) == 11); ok('my row is marked', len(page.query_selector_all('.item.me')) == 1)
    # challenge by code
    code = page.evaluate("CapmonGame.encodeBrainCode(CapmonGame.studentRef('Rival \\u202e<i>', 'Healspike', CapmonGame.styleProfile(d => d.ph === 0 ? 2 : 1)))")
    tap(page, '#tabbar [data-view="arena"]'); tap(page, '[data-act="open-code"]'); page.fill('#code-in', 'look: ' + code); tap(page, '[data-act="code-go"]')
    page.wait_for_selector('[data-act="ch-play"]'); tap(page, '[data-act="ch-play"]'); page.wait_for_selector('[data-act="w-skip-all"]'); tap(page, '[data-act="w-skip-all"]'); page.wait_for_selector('.result .score')
    st = page.evaluate('CapmonArena.state()'); ok('challenge stored, rating untouched', len(st['log']) == 1 and st['log'][0]['r0'] == st['log'][0]['r1'] and st['ranked']['played'] == 3)
    # replay check with a good and a tampered code
    mcode = st['log'][0]['code']
    tap(page, '#tabbar [data-view="check"]'); page.fill('#check-in', mcode); tap(page, '[data-act="check-go"]'); page.wait_for_selector('.chip.win')
    ok('good code verifies', 'replay matches' in page.inner_text('#view').lower())
    flip = mcode[:-1] + ('B' if mcode[-1] == 'A' else 'A')
    page.fill('#check-in', flip); tap(page, '[data-act="check-go"]'); page.wait_for_selector('.chip.loss'); ok('tampered code is caught', 'replay differs' in page.inner_text('#view').lower())
    page.fill('#check-in', 'm1.garbage'); tap(page, '[data-act="check-go"]'); ok('junk code gives an error', page.is_visible('#check-err'))
    tap(page, '[data-act="selfcheck"]'); page.wait_for_function("/Pass\\.|Fail\\./.test(document.querySelector('#view').innerText)", timeout=60000); ok('device test passes', 'Pass.' in page.inner_text('#view')); shot('7_check')
    # reload keeps the save
    page.reload(); page.wait_for_selector('#check-in'); ok('reload returns to the same view', True); tap(page, '#tabbar [data-view="arena"]'); page.wait_for_selector('.hero-name'); ok('save survives reload', 'tik' in page.inner_text('.hero-name').lower() and page.query_selector('#ob-form') is None)
    over = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'); ok('no sideways scroll', over <= 0, over)
    # a challenge link on a fresh device
    ctx2 = b.new_context(**kw); p2 = ctx2.new_page(); p2.on('pageerror', lambda e: errors.append('pageerror2: ' + str(e)))
    p2.goto(URL + '#c=' + code); p2.wait_for_selector('[data-act="ch-onboard"]', timeout=30000); tap(p2, '[data-act="ch-onboard"]'); p2.fill('#ob-name', 'Newbie'); tap(p2, 'button[type=submit]')
    p2.wait_for_selector('[data-act="w-skip-all"]', timeout=20000); tap(p2, '[data-act="w-skip-all"]'); p2.wait_for_selector('.result .score'); ok('challenge link works for a new visitor', True)
    p3 = ctx2.new_page(); p3.on('pageerror', lambda e: errors.append('pageerror3: ' + str(e))); p3.goto(URL + '#m=' + mcode); p3.wait_for_selector('.chip.win', timeout=30000); ok('match link opens the replay check', 'replay matches' in p3.inner_text('#view').lower())
    tap(p3, '[data-act="check-watch"]'); p3.wait_for_selector('[data-act="w-skip-all"]'); tap(p3, '[data-act="w-skip-all"]'); p3.wait_for_selector('.result .score'); ok('shared match can be watched', 'did not match' not in p3.inner_text('#view'))
    ctx2.close(); ctx.close()
    results[name] = {'steps': steps, 'errors': errors, 'failed': [s for s in steps if not s['ok']]}
try:
    time.sleep(1.0)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        run('phone', p.devices['iPhone 13'], p, b)
        run('desktop', {'viewport': {'width': 1280, 'height': 800}}, p, b)
        b.close()
    bad = False
    for k, v in results.items():
        print(k, 'steps', len(v['steps']), 'failed', json.dumps(v['failed']), 'errors', json.dumps(v['errors'][:6]))
        if v['failed'] or v['errors']: bad = True
    print('RESULT:', 'FAIL' if bad else 'PASS'); sys.exit(1 if bad else 0)
finally:
    srv.terminate()
