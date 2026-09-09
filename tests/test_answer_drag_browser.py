"""Shared native drag interaction/geometry regression. Requires Vite on port 5173."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / 'src/answerDrag.css').read_text(encoding='utf-8')
active = (ROOT / 'src/components_split/ACTIVE_EXAM.txt').read_text(encoding='utf-8')
css = '\n'.join(l.strip() for l in active.splitlines() if l.strip().startswith(('.idp-sentence-ending', '.idp-dropzone {'))) + '\n' + css

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1100, 'height': 900})
    page.route('**/drag-test', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><html><head></head><body></body></html>'))
    page.goto('http://127.0.0.1:5173/drag-test', wait_until='networkidle')
    page.evaluate("""async css => {
        window.dnd = await import('/src/answerDrag.ts');
        document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
        window.setup = (bankClass, optionClass, slotClass='idp-dropzone') => {
            document.body.innerHTML = `<main class="exam-content-block"><section data-dnd-question-ids="q1|q2"><div id="q1" data-qid="q1" class="${slotClass}">1</div><div id="q2" data-qid="q2" class="${slotClass}">2</div><div id="bank" class="${bankClass}" style="min-height:70px;padding:10px"><button id="a" class="${optionClass}" draggable="true">First answer</button><button id="b" class="${optionClass}" draggable="true">Second answer</button></div></section><section data-dnd-question-ids="other"><div id="other" data-qid="other" class="idp-dropzone">Invalid group</div></section></main>`;
            window.assignments = {};
            window.payload = null;
            const render = () => {
                for(const q of ['q1','q2']) {const el=document.getElementById(q); const val=assignments[q];el.textContent=val||q;el.draggable=!!val;el.classList.toggle('filled',!!val);}
                for(const id of ['a','b']) {const el=document.getElementById(id);el.style.display=Object.values(assignments).includes(el.textContent)?'none':'';}
                localStorage.setItem('drag-regression',JSON.stringify(assignments));
            };
            document.querySelector('main').addEventListener('dragstart', e => {
                const el=e.target.closest('[draggable="true"]'); if(!el)return;
                payload={value:el.textContent,source:el.dataset.qid||''};
                e.dataTransfer.setData('text/plain',payload.value);e.dataTransfer.effectAllowed='copyMove';
                dnd.startAnswerDrag(e,payload.value);
            });
            document.querySelector('main').addEventListener('dragover', e => dnd.feedbackAnswerDrag(e), true);
            document.querySelector('main').addEventListener('drop', e => {
                if(!dnd.feedbackAnswerDrag(e)||!payload)return;
                const bank=dnd.answerBankAt(e.target);
                const q=e.target.closest('[data-qid]')?.dataset.qid;
                if(bank) {if(payload.source)delete assignments[payload.source];}
                else if(q&&dnd.validAnswerTarget(q)) {assignments[q]=payload.value;if(payload.source&&payload.source!==q)delete assignments[payload.source];}
                else return;
                e.preventDefault();dnd.endAnswerDrag();render();
            },true);
            document.querySelector('main').addEventListener('dragend',()=>dnd.endAnswerDrag());
        };
    }""", css)
    types = [('sentence', 'idp-sentence-ending-bank', 'idp-sentence-ending-option', 'idp-dropzone'),
             ('headings', 'mh-heading-tray', 'mh-heading-option', 'idp-dropzone'),
             ('flowchart', 'idp-flowchart-bank', 'idp-wordbank-item', 'idp-dropzone'),
             ('matching', 'idp-match2-bank', 'idp-match2-tag', 'idp-dropzone'),
             ('summary', 'idp-wordbank', 'idp-wordbank-item', 'idp-dropzone'),
             ('map', 'idp-map-drag-bank', 'idp-map-drag-option', 'idp-map-drag-slot')]
    for name, bank, option, slot in types:
        page.evaluate('(args)=>setup(...args)', [bank, option, slot])
        page.locator('#a').hover()
        assert page.locator('#a').evaluate('(el)=>getComputedStyle(el).cursor') == 'move'
        assert page.locator('#a').evaluate('(el)=>getComputedStyle(el).borderTopColor') == 'rgb(9, 105, 218)'
        before = page.locator('#b').bounding_box()
        transfer = page.evaluate_handle('new DataTransfer()')
        page.locator('#a').dispatch_event('dragstart', {'dataTransfer': transfer})
        assert page.locator('#a').evaluate('(el)=>getComputedStyle(el).opacity') == '0.35'
        assert page.locator('#b').bounding_box() == before
        page.locator('#a').dispatch_event('dragend', {'dataTransfer': transfer})
        assert page.locator('#a').evaluate('(el)=>getComputedStyle(el).opacity') == '1'
        page.locator('#a').drag_to(page.locator('#other'))
        assert page.evaluate('assignments') == {}
        page.locator('#a').drag_to(page.locator('#q1'))
        assert page.evaluate('assignments') == {'q1': 'First answer'}
        assert not page.locator('#a').is_visible()
        page.locator('#q1').drag_to(page.locator('#q2'))
        assert page.evaluate('assignments') == {'q2': 'First answer'}
        page.locator('#b').drag_to(page.locator('#q2'))
        assert page.evaluate('assignments') == {'q2': 'Second answer'}
        assert page.locator('#a').is_visible()
        page.locator('#q2').drag_to(page.locator('#bank'))
        assert page.evaluate('assignments') == {}
        assert page.locator('#b').is_visible()
        print(f'PASS native DnD: {name}', flush=True)
    page.locator('#a').drag_to(page.locator('#q1'))
    page.reload(wait_until='networkidle')
    assert page.evaluate('JSON.parse(localStorage.getItem("drag-regression"))') == {'q1': 'First answer'}
    page.evaluate("async () => {window.dnd=await import('/src/answerDrag.ts');}")
    page.evaluate('(css)=>document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`)', css)
    options = ['Short ending.', 'She started by seeking to understand how basic terms were used in the past, before comparing the results with later scientific publications.']
    page.evaluate("""options => {
        document.body.innerHTML='<main class="exam-content-block"><div id="block" class="idp-sentence-ending" style="width:760px"><div class="idp-sentence-ending-row"><span id="slot1" class="idp-dropzone">1</span></div><div class="idp-sentence-ending-row"><span id="slot2" class="idp-dropzone">2</span></div></div></main>';
        window.stopMeasure=dnd.observeSentenceEnding(document.querySelector('#block'),options);
    }""", options)
    for width in [760, 310]:
        page.locator('#block').evaluate('(el,w)=>el.style.width=w+"px"', width)
        page.wait_for_timeout(100)
        initial = page.locator('#slot1').bounding_box()
        assert initial == {**page.locator('#slot2').bounding_box(), 'y': initial['y']}
        page.locator('#slot1').evaluate('(el,text)=>{el.classList.add("filled");el.textContent=text;}', options[-1])
        assert page.locator('#slot1').bounding_box() == initial
        assert page.locator('#slot1').evaluate('(el)=>el.scrollWidth<=el.clientWidth && el.scrollHeight<=el.clientHeight')
        page.locator('#slot1').evaluate('(el)=>{el.classList.remove("filled");el.textContent="1";}')
    page.evaluate('stopMeasure();localStorage.removeItem("drag-regression")')
    print('PASS shared measured slot widths/heights: desktop + narrow, longest option uncut')
    browser.close()
