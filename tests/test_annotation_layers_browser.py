"""Run with a Vite server on 5173: python tests/test_annotation_layers_browser.py."""
from pathlib import Path
import re
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'src/components_split/ACTIVE_EXAM.txt').read_text(encoding='utf-8')
css = '\n'.join(line.strip() for line in source.splitlines()
                if ('--hlbg:' in line or 'student-highlight' in line or 'student-note-hl' in line)
                and '{' in line and '}' in line and ' !important;' in line or '--hlbg:' in line)
icons = re.findall(r'<svg width="32" height="32" viewBox="0 0 64 64".*?</svg>', source)
assert len(icons) == 2
css += '\n' + '\n'.join(line.strip() for line in source.splitlines() if line.strip().startswith(('.idp-popup-', '.idp-highlight-delete-menu')))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1000, 'height': 700})
    page.route('**/annotation-test', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><html><head></head><body></body></html>'))
    page.goto('http://127.0.0.1:5173/annotation-test', wait_until='networkidle')
    page.evaluate("""async ({css, icons}) => {
        window.annotations = await import('/src/annotationLayers.ts');
        document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
        document.body.innerHTML = '<main class="exam-content-block"><div id="fixture" class="highlightable-content"></div></main>';
        document.body.insertAdjacentHTML('beforeend', `<div class="idp-popup-menu" style="left:200px;top:190px"><button class="idp-popup-btn">${icons[0]}Note</button><button class="idp-popup-btn">${icons[1]}Highlight</button></div><div class="idp-highlight-delete-menu" style="left:300px;top:200px"><button><svg viewBox="0 0 24 24"></svg><span>Delete<br>Highlight</span></button></div>`);
        window.reset = () => { document.querySelector('#fixture').innerHTML = '<b>abcdefghij</b>klmnopqrst'; };
        window.add = (start, end, type='HIGHLIGHT') => {
            const root = document.querySelector('#fixture');
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const nodes = []; let offset=0;
            while(walker.nextNode()) {const n=walker.currentNode; nodes.push([n,offset]);offset+=n.length;}
            for(const [node, offset] of nodes) {
                const from=Math.max(start-offset,0), to=Math.min(end-offset,node.length);
                if(to<=from) continue;
                const selected=node.splitText(from);
                if(to-from<selected.length) selected.splitText(to-from);
                const span=document.createElement('span');span.className='idp-temp-selection';
                selected.replaceWith(span);span.append(selected);
            }
            annotations.applySelectionAnnotation(root,type,'Keep this note');
            return root.querySelectorAll('[data-annotation-id]')[root.querySelectorAll('[data-annotation-id]').length-1].dataset.annotationId;
        };
        window.state = () => {
            const root=document.querySelector('#fixture');
            return [...root.querySelectorAll('[data-annotation-segment]')].map(el=>({text:el.textContent,kind:el.dataset.annotationSegment,bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
        };
        window.remove = (id) => { const root=document.querySelector('#fixture'); annotations.removeAnnotation(root,[...root.querySelectorAll('[data-annotation-id]')].find(el=>el.dataset.annotationId===id)); };
    }""", {'css': css, 'icons': icons})
    popup = page.locator('.idp-popup-menu').bounding_box()
    delete_popup = page.locator('.idp-highlight-delete-menu').bounding_box()
    assert popup and popup['width'] <= 120 and popup['height'] <= 52
    assert delete_popup and delete_popup['width'] <= 58 and delete_popup['height'] <= 48
    assert page.locator('.idp-popup-btn svg').evaluate_all('(els) => els.every(el => getComputedStyle(el).width === "21px" && getComputedStyle(el).height === "21px")')
    assert page.locator('.idp-highlight-delete-menu').inner_text() == 'Delete\nHighlight'
    assert 'Newest' not in page.locator('.idp-highlight-delete-menu').inner_text()
    screenshot = str(Path(tempfile.gettempdir()) / 'ielts-annotation-popup.png')
    page.screenshot(path=screenshot)
    print(f'Popup screenshot: {screenshot}', flush=True)
    count = 0
    for theme, base in [('', 'rgb(139, 26, 26)'), ('theme-dark', 'rgb(255, 224, 102)'), ('theme-yellow', 'rgb(156, 163, 175)')]:
        page.evaluate('(theme)=>document.querySelector("main").className="exam-content-block "+theme', theme)
        for first, second in [([2, 10], [6, 14]), ([4, 16], [7, 10]), ([5, 14], [1, 8]), ([2, 10], [2, 10]), ([6, 10], [2, 16])]:
            page.evaluate('reset()')
            page.evaluate('(r)=>add(...r)', first)
            first_id = page.locator('[data-annotation-id]').first.get_attribute('data-annotation-id')
            page.evaluate('(r)=>add(...r)', second)
            ids = page.locator('[data-annotation-id]').evaluate_all('(els)=>[...new Set(els.map(el=>el.dataset.annotationId))]')
            assert len(ids) == 2
            second_id = next(i for i in ids if i != first_id)
            overlap = [s for s in page.evaluate('state()') if s['kind'] == 'overlap']
            assert overlap and all(s['bg'] == 'rgb(255, 102, 221)' and s['fg'] == 'rgb(0, 0, 0)' for s in overlap)
            # Reload the persisted HTML through the production renderer, not the painted colour.
            page.evaluate('''() => {const root=document.querySelector('#fixture'); const html=root.innerHTML; root.innerHTML=annotations.annotationHTML(html); }''')
            page.evaluate('(id)=>remove(id)', second_id)
            states = page.evaluate('state()')
            assert all(s['kind'] == 'highlight' and s['bg'] == base for s in states)
            assert ''.join(s['text'] for s in states) == 'abcdefghijklmnopqrst'[first[0]:first[1]]
            page.evaluate('(id)=>remove(id)', first_id)
            assert not page.evaluate('state()')
            assert page.locator('#fixture').inner_text() == 'abcdefghijklmnopqrst'
            count += 1
        page.evaluate('reset();add(2,16);add(4,12);add(6,10)')
        first_id = page.locator('.student-highlight').first.get_attribute('data-annotation-id')
        page.evaluate('(id)=>remove(id)', first_id)
        assert ''.join(s['text'] for s in page.evaluate('state()') if s['kind'] == 'overlap') == 'ghij'
        page.evaluate('reset();add(2,12);add(4,8,"NOTE")')
        assert all(s['kind'] == 'highlight' and s['bg'] == base for s in page.evaluate('state()'))
        for note_range, highlight_range in [([2, 8], [4, 12]), ([2, 8], [0, 16])]:
            for delete_note in [False, True]:
                page.evaluate('reset()')
                page.evaluate('(r)=>add(...r,"NOTE")', note_range)
                note_id = page.locator('.student-note-hl').first.get_attribute('data-note-id')
                page.evaluate('(r)=>add(...r)', highlight_range)
                hl_id = page.locator('.student-highlight').first.get_attribute('data-annotation-id')
                assert page.locator('.student-note-hl').first.get_attribute('data-note') == 'Keep this note'
                assert all(s['kind'] != 'overlap' for s in page.evaluate('state()'))
                page.evaluate('(id)=>remove(id)', note_id if delete_note else hl_id)
                assert all(s['kind'] == ('highlight' if delete_note else 'note') for s in page.evaluate('state()'))
                count += 1
    # Legacy migration preserves notes, nested highlights and deterministic identities.
    page.evaluate('''() => {const root=document.querySelector('#fixture'); root.innerHTML=annotations.annotationHTML('<span class="student-note-hl" data-note="legacy"><span class="student-highlight">ab<span class="student-highlight">cd</span>ef</span></span>');}''')
    assert page.locator('[data-annotation-segment="overlap"]').inner_text() == 'cd'
    assert page.locator('.student-note-hl').get_attribute('data-note') == 'legacy'
    page.evaluate('localStorage.setItem("annotation-regression", document.querySelector("#fixture").innerHTML)')
    page.reload(wait_until='networkidle')
    page.evaluate('''async () => {const m=await import('/src/annotationLayers.ts'); document.body.innerHTML='<div id="fixture"></div>'; document.querySelector('#fixture').innerHTML=m.annotationHTML(localStorage.getItem('annotation-regression'));}''')
    assert page.locator('[data-annotation-segment="overlap"]').inner_text() == 'cd'
    assert page.locator('[data-annotation-id]').count() == 3
    page.evaluate('localStorage.removeItem("annotation-regression")')
    print(f'PASS: {count} theme/range/deletion cases, legacy migration, real page reload, SVG structure')
    browser.close()
