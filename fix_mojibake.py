# -*- coding: utf-8 -*-
# Khôi phục emoji/ký hiệu bị mojibake (UTF-8 bị giải mã nhầm sang Latin-1/CP1252).
# An toàn: chỉ thay khi chuỗi giải mã lại thành ký hiệu/emoji (>= U+2000), không đụng chữ Việt.
import re, glob, io

SPECIALS = {
 '€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,
 '†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,'Š':0x8a,
 '‹':0x8b,'Œ':0x8c,'Ž':0x8e,'‘':0x91,'’':0x92,
 '“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,
 '˜':0x98,'™':0x99,'š':0x9a,'›':0x9b,'œ':0x9c,
 'ž':0x9e,'Ÿ':0x9f,
}
def tobyte(ch):
    o=ord(ch)
    if 0x80<=o<=0xff: return o
    return SPECIALS.get(ch)

SUSP = re.compile('[-ÿŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]+')

def fix_run(m):
    run=m.group(0)
    bs=bytearray()
    for ch in run:
        b=tobyte(ch)
        if b is None: return run
        bs.append(b)
    try:
        dec=bs.decode('utf-8')
    except Exception:
        return run
    if not dec: return run
    for c in dec:
        if ord(c) < 0x2000:   # chỉ nhận ký hiệu/emoji, từ chối chữ cái/số
            return run
    return dec

files = ['src/App.template.tsx'] + glob.glob('src/components_split/*.txt')
total=0
for f in files:
    if f.endswith('.bak') or '.bak_' in f: continue
    with io.open(f,'r',encoding='utf-8') as fh: s=fh.read()
    ns=SUSP.sub(fix_run,s)
    if ns!=s:
        n=sum(1 for a,b in zip(s,ns) if a!=b)
        with io.open(f,'w',encoding='utf-8') as fh: fh.write(ns)
        print('FIXED',f)
        total+=1
print('done files changed:',total)
