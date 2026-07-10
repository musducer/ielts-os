# -*- coding: utf-8 -*-
"""
PATCH 01 - Thay emoji -> <Ico> cho REVIEW_QUIZ.txt (+ bo sung 4 icon moi vao App.template.tsx)
Idempotent. Khong dung phong thi, khong dung store. Anchor dung escape \\u de tranh sai lech ky tu.
"""
import io, sys

def read(p):  return io.open(p, 'r', encoding='utf-8').read()
def write(p, s): io.open(p, 'w', encoding='utf-8').write(s)

TEMPLATE = 'src/App.template.tsx'
RQ = 'src/components_split/REVIEW_QUIZ.txt'

# 1) BO SUNG ICON MOI VAO BO Ico (App.template.tsx)
NEW_ICONS = {
 'clipboard': '<><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></>',
 'chat':      '<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></>',
 'barChart':  '<><path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/></>',
 'bulb':      '<><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></>',
}
t = read(TEMPLATE)
ANCHOR = ('        copy: <><rect x="9" y="9" width="13" height="13" rx="2"/>'
          '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,\n')
if ANCHOR not in t:
    print('!! KHONG tim thay anchor icon map — DUNG.'); sys.exit(1)
inserts = ''
for name, body in NEW_ICONS.items():
    if f'\n        {name}:' not in t:
        inserts += f'        {name}: {body},\n'
if inserts:
    t = t.replace(ANCHOR, ANCHOR + inserts); write(TEMPLATE, t)
    print(f'OK them {inserts.count(chr(10))} icon moi vao App.template.tsx')
else:
    print('OK icon da day du')

# 2) THAY EMOJI TRONG REVIEW_QUIZ.txt — anchor dung escape codepoint
box = lambda n: f'<Ico name="{n}" size={{18}} />'
inl = lambda n: f'<Ico name="{n}" size={{15}} style={{{{verticalAlign:\'-2px\',marginRight:6,display:\'inline-block\'}}}} />'
CLIP='\U0001F4CB'; TGT='\U0001F3AF'; CHK='✔️'; CHAT='\U0001F4AC'
PIN='\U0001F4CC'; BAR='\U0001F4CA'; BULB='\U0001F4A1'

REPL = [
 (f"borderRadius: 8}}}}>{CLIP}</div>", f"borderRadius: 8}}}}>{box('clipboard')}</div>"),
 (f"borderRadius: 8}}}}>{TGT}</div>",  f"borderRadius: 8}}}}>{box('target')}</div>"),
 (f"borderRadius: 8}}}}>{CHK}</div>",  f"borderRadius: 8}}}}>{box('check')}</div>"),
 (f">{CHAT} Teacher's feedback:",       f">{inl('chat')}Teacher's feedback:"),
 (f">{PIN} Flagged questions during exam:", f">{inl('pin')}Flagged questions during exam:"),
 (f">{BAR} WEAKNESS ANALYSIS BY TYPE",  f">{inl('barChart')}WEAKNESS ANALYSIS BY TYPE"),
 (f">{BULB} {{t('explain_why')}}",      f">{inl('bulb')}{{t('explain_why')}}"),
 (f">{BULB} {{t('explain_title')}}:",   f">{inl('bulb')}{{t('explain_title')}}:"),
]
r = read(RQ); done=skip=0; miss=[]
for i,(old,new) in enumerate(REPL):
    if old in r: r=r.replace(old,new,1); done+=1
    elif new in r: skip+=1
    else: miss.append(i)
write(RQ, r)
print(f'OK REVIEW_QUIZ.txt: thay {done}, da-co {skip}, MISS index={miss}')
print('DONE patch_01')
