# -*- coding: utf-8 -*-
"""PATCH 02 - Don straggler ⏱(23F1) ⏳(23F3) ▶(25B6). Idempotent.
   GIU store: STUDENT_PORTAL L343 (>⏳</div> the doi deadline) KHONG dung."""
import io
def rd(p): return io.open(p,'r',encoding='utf-8').read()
def wr(p,s): io.open(p,'w',encoding='utf-8').write(s)
HG='⏳'; SW='⏱'; PLAY='▶'
INL=lambda n,s=14: f'<Ico name="{n}" size={{{s}}} style={{{{verticalAlign:\'-2px\',marginRight:6,display:\'inline-block\'}}}} />'
SPAN=lambda inner: '<span style={{display:\'inline-flex\',alignItems:\'center\',gap:6}}>'+inner+'</span>'

def patch(path, rules, label):
    s=rd(path); done=0; miss=[]
    for i,(a,b) in enumerate(rules):
        if a in s: s=s.replace(a,b,1); done+=1
        elif b in s: pass
        else: miss.append(i)
    wr(path,s); print(f'{label}: thay {done}, MISS={miss}')

# 1) TEMPLATE: strip ⏱/⏳ trong dict & alert (string context, khong dat Ico duoc)
t=rd('src/App.template.tsx')
for a in (f'"{SW} ', f'"{SW}'):
    t=t.replace(a,'"')
t=t.replace(f'{HG} ','').replace(HG,'').replace(f'{SW} ','').replace(SW,'')
wr('src/App.template.tsx',t)
print('TEMPLATE: stripped 23F1/23F3')

# 2) ACADEMICS L209 - AI feedback loading
patch('src/components_split/ACADEMICS.txt',[
 (f">{{aiLoadingId === r.id ? '{HG}' : 'AI'}}</button>",
  ">{aiLoadingId === r.id ? "+f'<Ico name="refresh" size={{14}} />'+" : "+SPAN('<Ico name="sparkles" size={14} /> AI')+"}</button>"),
],'ACADEMICS')

# 3) EXAM_BUILDER L477 - transcribe loading
patch('src/components_split/EXAM_BUILDER.txt',[
 (f"{{transcribeLoading ? '{HG} ' + (transcribeMsg || t('eb_transcribing')) : '' + t('eb_transcribe')}}",
  "{transcribeLoading ? "+SPAN('<Ico name="refresh" size={14} /> {transcribeMsg || t(\'eb_transcribing\')}')
  +" : "+SPAN('<Ico name="headphones" size={14} /> {t(\'eb_transcribe\')}')+"}"),
],'EXAM_BUILDER')

# 4) PENDING_EXAM L68
patch('src/components_split/PENDING_EXAM.txt',[
 (f"{{isListeningExam ? '{PLAY}  Start Test' : 'Start Test'}}",
  "{isListeningExam ? "+SPAN('<Ico name="play" size={14} /> Start Test')+" : 'Start Test'}"),
],'PENDING_EXAM')

# 5) REVIEW_QUIZ L141 (box) + L275 (loading)
patch('src/components_split/REVIEW_QUIZ.txt',[
 (f"borderRadius: 8}}}}>{SW}</div>", 'borderRadius: 8}}><Ico name="clock" size={18} /></div>'),
 (f">{HG} {{t('explain_loading')}}", ">"+INL('refresh')+"{t('explain_loading')}"),
],'REVIEW_QUIZ')

# 6) STUDENT_PORTAL L390 (loading) + L599 (status)  -- L343 store: KHONG dung
patch('src/components_split/STUDENT_PORTAL.txt',[
 (f"{{vocabGenLoading ? '{HG} ' + t('vocab_generating') : '' + t('vocab_generate')}}",
  "{vocabGenLoading ? "+SPAN('<Ico name="refresh" size={14} /> {t(\'vocab_generating\')}')
  +" : "+SPAN('<Ico name="sparkles" size={14} /> {t(\'vocab_generate\')}')+"}"),
 (f"{HG} {{isLockedByOtherDevice ? t('locked_other_device') : statusText}}",
  INL('clock')+"{isLockedByOtherDevice ? t('locked_other_device') : statusText}"),
],'STUDENT_PORTAL')
print('DONE patch_02')
