# -*- coding: utf-8 -*-
import re
E = r'[^\x00-\x7F]+'
def apply(path, rules):
    s = open(path, encoding='utf-8').read()
    for pat, repl, n in rules:
        s2, c = re.subn(pat, repl, s)
        print(('OK ' if c == n else '!! ') + f'{c}/{n}  {path.split("/")[-1]}  {pat[:40]}')
        s = s2
    open(path, 'w', encoding='utf-8').write(s)

apply('src/components_split/ACADEMICS.txt', [
    (r"<h2 style=\{\{marginTop:0, fontSize: 16\}\}>" + E,
     "<h2 style={{marginTop:0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8}}><Ico name=\"pin\" size={15} color={C.accent} />", 1),
])
apply('src/components_split/CLASSROOM.txt', [
    (E + r"(?= \{t\('cls_teacher_incharge'\)\})", "<Ico name=\"user\" size={14} color={C.sub} />", 1),
])
apply('src/components_split/HISTORY.txt', [
    (E + r"(?= \{t\('hist_delete'\)\})", "<Ico name=\"trash\" size={14} />", 1),
])
print('DONE')
