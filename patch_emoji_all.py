# -*- coding: utf-8 -*-
"""
PATCH TONG - Thay/Go emoji -> <Ico> cho 11 file (CHUA phong thi ACTIVE_EXAM, CHUA store).
Content-driven, idempotent, tu kiem tra. Chay: python patch_emoji_all.py
Chien luoc:
  1) Them icon moi vao bo Ico (App.template.tsx)
  2) Tu dien t(): go emoji khoi value (EN+VI) + chen <Ico> tai site render >{t('key')}
  3) Markup emoji thuan / ternary quan trong -> <Ico> (anchor noi dung)
  4) STUDENT_PORTAL: chi xu ly NGOAI store
  5) Quet don cuoi: xoa emoji con sot trong pham vi (chua decorative)
  6) Verify 0 emoji
"""
import io, re, os, glob, sys

def read(p): return io.open(p,'r',encoding='utf-8').read()
def write(p,s): io.open(p,'w',encoding='utf-8').write(s)

TEMPLATE='src/App.template.tsx'
TXT_DIR='src/components_split'
EXCLUDE_BASENAMES={'ACTIVE_EXAM.txt'}              # phong thi - KHONG dung
ALL_TXT=[f for f in sorted(glob.glob(TXT_DIR+'/*.txt'))
         if '.bak' not in f and os.path.basename(f) not in EXCLUDE_BASENAMES]
SCOPE=[TEMPLATE]+ALL_TXT

# ----- decorative: KHONG coi la emoji, giu nguyen -----
DECOR=set('•●○│─')  # bullet, progress dots, box light
DECOR|= {chr(c) for c in range(0x2580,0x25A0)} # block elements
ARROW_RANGE=range(0x2190,0x2200)              # mui ten: chi xu ly co chu dich, con lai de yen

EMOJI_RE=re.compile(
 "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002190-\U000021FF"
 "\U00002B00-\U00002BFF\U00002460-\U000024FF\U00002900-\U00002BEF"
 "\U0000FE00-\U0000FE0F™ℹ⭐]")

def is_emoji(ch):
    return bool(EMOJI_RE.match(ch)) and ch not in DECOR

# ============================================================
# 1) ICON MOI
# ============================================================
NEW_ICONS = {
 'x': '<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>',
 'printer': '<><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>',
 'key': '<><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>',
 'save': '<><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></>',
 'download': '<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></>',
 'cloud': '<><path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.8A7 7 0 1 0 4 15.3"/></>',
 'wrench': '<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></>',
 'compass': '<><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>',
 'hash': '<><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>',
 'unlock': '<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>',
 'refresh': '<><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>',
 'expand': '<><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></>',
 'moon': '<><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></>',
 'crown': '<><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></>',
 'star': '<><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>',
 'medal': '<><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><circle cx="12" cy="17" r="5"/><path d="M11 17h2"/></>',
 'sparkles': '<><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></>',
 'mic': '<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></>',
 'headphones': '<><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></>',
 'dot': '<><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></>',
 'arrowRight': '<><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>',
 'arrowUp': '<><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>',
 'arrowDown': '<><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>',
 'moveV': '<><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></>',
 'play': '<><polygon points="6 4 20 12 6 20 6 4"/></>',
 'music': '<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>',
 'link': '<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></>',
 'ruler': '<><path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/></>',
 'puzzle': '<><path d="M19.4 12.5a2 2 0 1 0 0-3.4V7a2 2 0 0 0-2-2h-2.1a2 2 0 1 0-3.4 0H7a2 2 0 0 0-2 2v2.1a2 2 0 1 0 0 3.4V15a2 2 0 0 0 2 2h2.1a2 2 0 1 0 3.4 0H17a2 2 0 0 0 2-2z"/></>',
 'trendingDown': '<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>',
 'megaphone': '<><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>',
 'ban': '<><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></>',
 'pointer': '<><path d="M7 14V5a2 2 0 0 1 4 0v6"/><path d="M11 11V3a2 2 0 0 1 4 0v8"/><path d="M15 10a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a8 8 0 0 1-7-5l-1-2"/></>',
 'checkSquare': '<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>',
 'radio': '<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>',
 'info': '<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>',
 'siren': '<><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 2v1"/><path d="m4.6 5.6 .7.7"/><path d="m18.7 6.3 .7-.7"/></>',
 'cross': '<><path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z"/></>',
}

t = read(TEMPLATE)
ANCHOR=('        copy: <><rect x="9" y="9" width="13" height="13" rx="2"/>'
        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,\n')
if ANCHOR not in t:
    print('!! khong thay anchor icon map'); sys.exit(1)
ins=''
for n,b in NEW_ICONS.items():
    if f'\n        {n}:' not in t: ins+=f'        {n}: {b},\n'
if ins:
    t=t.replace(ANCHOR, ANCHOR+ins)
    print(f'OK them {ins.count(chr(10))} icon moi')
write(TEMPLATE,t)

# ============================================================
# EMOJI -> ICON name (theo codepoint)
# ============================================================
M = {
 0x2713:'check',0x2714:'check',0x2705:'check',0x2611:'checkSquare',
 0x2717:'x',0x2716:'x',0x274C:'xcircle',0x2715:'x',
 0x1F4CA:'barChart',0x1F4C8:'trending',0x1F4C9:'trendingDown',
 0x26A0:'alert',0x1F6A8:'siren',0x1F6E0:'wrench',0x2601:'cloud',
 0x1F512:'lock',0x1F513:'unlock',0x1F510:'lock',0x1F4CC:'pin',0x1F4CD:'pin',
 0x1F464:'user',0x1F465:'users',0x1F514:'bell',0x2B07:'arrowDown',0x2191:'arrowUp',
 0x1F381:'gift',0x1F5A8:'printer',0x1F4B0:'coins',0x1F5D1:'trash',
 0x1F3AF:'target',0x1F3C6:'trophy',0x1F50D:'search',0x1F552:'clock',0x1F4BB:'monitor',
 0x1F4CB:'clipboard',0x1F6AB:'ban',0x1F4C1:'folder',0x1F4C2:'folder',0x1F4E5:'download',
 0x1F511:'key',0x1F9ED:'compass',0x2699:'gear',0x1F4BE:'save',0x1F4D6:'book',
 0x29C9:'copy',0x1F4DD:'edit',0x270F:'edit',0x1F522:'hash',0x1F4C4:'file',
 0x1F6E1:'shield',0x1F441:'eye',0x1F504:'refresh',0x1F4C5:'calendar',
 0x2922:'expand',0x2630:'list',0x2AF8:'list',0x1F319:'moon',0x2195:'moveV',
 0x1F451:'crown',0x1F31F:'star',0x1F947:'medal',0x1F948:'medal',0x1F949:'medal',
 0x1F44F:'star',0x2728:'sparkles',0x1F3A4:'mic',0x1F3A7:'headphones',0x1F4A4:'moon',
 0x1F534:'dot',0x279E:'arrowRight',0x25B6:'play',0x2192:'arrowRight',0x1F3B5:'music',
 0x1F517:'link',0x1F4AC:'chat',0x1F4D0:'ruler',0x1F9E9:'puzzle',0x1F4E2:'megaphone',
 0x1F446:'pointer',0x1FAF3:'pointer',0x1F518:'radio',0x2139:'info',0x1F524:'book',
 0x1F635:'xcircle',0x1F60E:'check',0x1F389:'sparkles',0x1F525:'star',0x1F680:'star',
 0x1F455:'shield',
}
def icon_for(ch):
    return M.get(ord(ch))

def ico(name,size=15,trailing=False):
    mg = "'0 0 0 6px'" if trailing else "'0 6px 0 0'"
    return (f"<Ico name=\"{name}\" size={{{size}}} "
            f"style={{{{verticalAlign:'-2px',margin:{mg},display:'inline-block'}}}} />")

# ============================================================
# 2) TU DIEN t(): go emoji + ghi key->icon
# ============================================================
DICT_RE=re.compile(r'^(\s+)([a-zA-Z0-9_]+): "(.*?)",?\s*$')
key_icon={}   # key -> (iconname, trailing)
lines=t.split('\n')
out=[]
for ln in lines:
    m=DICT_RE.match(ln)
    if m and any(is_emoji(c) for c in m.group(3)):
        indent,key,val=m.groups()
        chars=list(val)
        # leading emoji?
        i=0
        lead=[]
        while i<len(chars) and (is_emoji(chars[i]) or chars[i]=='️'):
            lead.append(chars[i]); i+=1
        if lead:
            while i<len(chars) and chars[i]==' ': i+=1
            ic=next((icon_for(c) for c in lead if icon_for(c)),None)
            if ic: key_icon[key]=(ic,False)
            newval=''.join(chars[i:])
        else:
            # trailing emoji
            j=len(chars)
            trail=[]
            while j>0 and (is_emoji(chars[j-1]) or chars[j-1]=='️'):
                trail.insert(0,chars[j-1]); j-=1
            while j>0 and chars[j-1]==' ': j-=1
            ic=next((icon_for(c) for c in trail if icon_for(c)),None)
            if ic: key_icon[key]=(ic,True)
            newval=''.join(chars[:j])
        # giu nguyen dau phay cuoi neu co
        tail=',' if ln.rstrip().endswith(',') else ''
        out.append(f'{indent}{key}: "{newval}"{tail}')
    else:
        out.append(ln)
t='\n'.join(out)
write(TEMPLATE,t)
print(f'OK go emoji tu dien, {len(key_icon)} key co icon')

# ============================================================
# 3) CHEN <Ico> tai site render >{t('key')} cho cac key tren (moi file in-scope)
# ============================================================
def inject_render(content):
    for key,(name,trailing) in key_icon.items():
        ic=ico(name, size=14, trailing=trailing)
        for q in ("'",'"'):
            call=f"t({q}{key}{q})"
            if not trailing:
                # >{t('key')}  (khong sau /> hoac =>)
                pat=re.compile(r'(?<![/=])>\{'+re.escape(call)+r'\}')
                content=pat.sub('>'+ic+'{'+call+'}', content)
            else:
                pat=re.compile(r'\{'+re.escape(call)+r'\}<(?!Ico)')
                content=pat.sub('{'+call+'}'+ic+'<', content)
    return content

# ============================================================
# 4) MARKUP / TERNARY quan trong (content-driven, dung escape)
# ============================================================
def ICO(name,size): return f'<Ico name="{name}" size={{{size}}} />'
MARKUP_TEMPLATE=[
 # confetti div
 ('>\U0001F389</div>', '>'+ICO('sparkles',64)+'</div>'),
 # contrast eye button
 ('>\U0001F441️</button>', '>'+ICO('eye',18)+'</button>'),
 # scroll-to-top arrow button
 ('>↑</button>', '>'+ICO('arrowUp',20)+'</button>'),
]
MARKUP_TXT={
 'EXAM_BUILDER.txt':[
   ("{q.type === 'Listening' ? '\U0001F3A7' : '\U0001F4D6'}",
    "{q.type === 'Listening' ? "+ICO('headphones',28)+" : "+ICO('book',28)+"}"),
 ],
 'ACADEMICS.txt':[
   ('{i === 0 ? "\U0001F947" : i === 1 ? "\U0001F948" : i === 2 ? "\U0001F949" : "\U0001F44F"}',
    '{i === 0 ? '+ICO('medal',20)+' : i === 1 ? '+ICO('medal',20)+' : i === 2 ? '+ICO('medal',20)+' : '+ICO('star',20)+'}'),
   ("title={t('tip_voice_input')}>\U0001F3A4</button>",
    "title={t('tip_voice_input')}>"+ICO('mic',16)+"</button>"),
 ],
 'CLASSROOM.txt':[
   ("\U0001F464 {t('cls_teacher_incharge')}", ICO('user',14)+" {t('cls_teacher_incharge')}"),
 ],
 'LIVE_ARENA.txt':[
   ("'pulseFast 1.5s infinite'}}>\U0001F534</span>", "'pulseFast 1.5s infinite'}}>"+ICO('dot',18)+"</span>"),
   ("marginBottom: 15}}>\U0001F4A4</div>", "marginBottom: 15}}>"+ICO('moon',36)+"</div>"),
 ],
 'PENDING_EXAM.txt':[
   ("borderRadius: '50%', background: '#2da44e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, margin: '0 auto 16px' }}>✓</div>",
    "borderRadius: '50%', background: '#2da44e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, margin: '0 auto 16px' }}>"+ICO('check',24)+"</div>"),
 ],
 'STUDENT_PORTAL.txt':[
   # NGOAI store: vocab category icons (data) -> icon name
   ("{ key: 'word', icon: '\U0001F524', color: C.accent }", "{ key: 'word', icon: 'book', color: C.accent }"),
   ("{ key: 'phrasal_verb', icon: '\U0001F9E9', color: '#7c3aed' }", "{ key: 'phrasal_verb', icon: 'puzzle', color: '#7c3aed' }"),
   ("{ key: 'idiom', icon: '\U0001F4AC', color: '#db2777' }", "{ key: 'idiom', icon: 'chat', color: '#db2777' }"),
   ("{ key: 'collocation', icon: '\U0001F517', color: '#0891b2' }", "{ key: 'collocation', icon: 'link', color: '#0891b2' }"),
   ("{ key: 'grammar', icon: '\U0001F4D0', color: '#ea580c' }", "{ key: 'grammar', icon: 'ruler', color: '#ea580c' }"),
   # render cat icon: <span>{on ? '✓' : ''}{cat.icon}</span>
   ("<span>{on ? '✓' : ''}{cat.icon}</span>",
    "<span style={{display:'inline-flex',alignItems:'center',gap:4}}>{on ? <Ico name=\"check\" size={12} /> : null}<Ico name={cat.icon} size={14} /></span>"),
   # vocab done / forgot / remember / idiom / tap
   (">\U0001F389 {t('vocab_done_today')}", ">"+ICO('sparkles',16)+" {t('vocab_done_today')}"),
   (">\U0001F446 {t('vocab_tap_flip')}", ">"+ICO('pointer',14)+" {t('vocab_tap_flip')}"),
   (">\U0001F635 {t('vocab_forgot')}", ">"+ICO('xcircle',16)+" {t('vocab_forgot')}"),
   (">\U0001F60E {t('vocab_remember')}", ">"+ICO('check',16)+" {t('vocab_remember')}"),
   (">✨ IDIOM OF THE MONTH", ">"+ICO('sparkles',14)+" IDIOM OF THE MONTH"),
   ("\U0001F4CD {t('vocab_from_test')}", ICO('pin',13)+" {t('vocab_from_test')}"),
   (">✕</button>", ">"+ICO('x',13)+"</button>"),
   # generate vocab button: '✨ ' + t(...) -> keep text, replace emoji char by Ico is hard in string -> strip handled later
 ],
}

# ============================================================
# STORE GUARD (STUDENT_PORTAL): cac CHUOI store KHONG duoc dung toi
# ============================================================
STORE_GUARD_SP=[
 '\U0001F525 CHI', '\U0001F392', '\U0001F3C6 DANH HI', '\U0001F355', '\U0001F622',
 '\U0001F381 B', 'fall 3s linear', "['\U0001F389','\U0001F31F','\U0001F525','\U0001F680','\U0001F3C6']",
 'setShowInventory(false)', 'setInvTab("CONSUMABLE")', '\U0001F3B0', 'REWARDS STORE',
 'my_inventory_btn', 'handleBuyConsumable', '\U0001F9C3', '\U0001F379',
]

# ============================================================
# APPLY
# ============================================================
def apply_file(path):
    base=os.path.basename(path)
    c=read(path)
    # render inject (tat ca file in-scope)
    c=inject_render(c)
    # markup template-only
    if base=='App.template.tsx':
        for a,b in MARKUP_TEMPLATE:
            if a in c: c=c.replace(a,b)
    # markup per-file
    for a,b in MARKUP_TXT.get(base,[]):
        if a in c: c=c.replace(a,b)
    write(path,c)

for p in SCOPE:
    apply_file(p)
print('OK inject + markup')

# ============================================================
# 5) QUET DON CUOI: xoa emoji con sot (chua decorative, chua store SP)
# ============================================================
def strip_emoji_line(line, guard=False):
    if guard and any(g in line for g in STORE_GUARD_SP):
        return line  # dong store -> giu nguyen
    if not any(is_emoji(c) for c in line):
        return line
    # xoa emoji + FE0F, gop khoang trang hop ly
    def repl(m):
        s,e=m.start(),m.end()
        before=line[s-1] if s>0 else ''
        after=line[e] if e<len(line) else ''
        if before not in ('',' ','"',"'",'>','`','(') and after not in ('',' ','"',"'",'<','`',')'):
            return ' '
        return ''
    pat=re.compile(r'[ ]?(?:'+EMOJI_RE.pattern+r'|️)+[ ]?')
    # chi xoa emoji that (khong decorative)
    res=[]
    i=0
    chars=list(line)
    while i<len(chars):
        if is_emoji(chars[i]) or chars[i]=='️':
            j=i
            while j<len(chars) and (is_emoji(chars[j]) or chars[j]=='️'): j+=1
            before=chars[i-1] if i>0 else ''
            after=chars[j] if j<len(chars) else ''
            # nuot 1 space ke ben
            if after==' ' and before in ('','>','"',"'",'`','('):
                j+=1
            elif before==' ' and after in ('','<','"',"'",'`',')'):
                res.pop()
            i=j
        else:
            res.append(chars[i]); i+=1
    return ''.join(res)

for p in SCOPE:
    base=os.path.basename(p)
    guard = (base=='STUDENT_PORTAL.txt')
    c=read(p)
    # don C1 control
    c=re.sub('[-]','',c)
    newlines=[strip_emoji_line(l, guard) for l in c.split('\n')]
    write(p,'\n'.join(newlines))
print('OK quet don cuoi + C1')

# ============================================================
# 6) VERIFY
# ============================================================
print('\n===== VERIFY =====')
bad=0
for p in SCOPE:
    base=os.path.basename(p)
    c=read(p)
    rem=[]
    for i,l in enumerate(c.split('\n'),1):
        for ch in l:
            if is_emoji(ch):
                if base=='STUDENT_PORTAL.txt' and any(g in l for g in STORE_GUARD_SP):
                    continue
                rem.append((i,f'{ord(ch):04X}'))
    # soat <Ico lot vao chuoi (giua dau nhay ' hoac ")
    for i,l in enumerate(c.split('\n'),1):
        for mm in re.finditer(r'"[^"\n]*<Ico', l):
            bad+=1; print(f'  !! <Ico trong chuoi "..." {base}:{i}')
    if rem:
        bad+=len(rem)
        print(f'  REMAIN {base}: {len(rem)} -> {rem[:8]}')
print('store SP giu nguyen, exam room khong dung.')
print('KET QUA:', 'PASS (0 emoji con sot, 0 Ico-in-string)' if bad==0 else f'CO VAN DE: {bad}')
