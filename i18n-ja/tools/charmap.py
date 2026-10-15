#!/usr/bin/env python3
"""辞書に無い文字列のための「1文字ずつの字体変換表」を作る。

  python3 i18n-ja/tools/charmap.py   → dict/charmap.json

簡体字 1 文字 → 日本の字体（OpenCC: 簡体→繁体→日本の新字体）。
次の字は変換しない（文脈で字が変わり、1文字では決められないため）:
  - 繁体字にも同じ字がある字（后・干・台・里・余・面 など。Big5 に含まれる字）
  - 複数の繁体字に分かれる字（发→發/髮 など）
  - 術数で意味が変わる字（sweep.py と同じ）
必要: pip install opencc
"""
import json, os
import opencc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = set('干占冲斗卜丑云')
s2t = opencc.OpenCC('s2t')
t2s = opencc.OpenCC('t2s')
t2jp = opencc.OpenCC('t2jp')

def in_big5(c):
    try:
        c.encode('big5')
        return True
    except UnicodeEncodeError:
        return False

chars = [chr(u) for u in range(0x4E00, 0xA000)]
back = {}
for u in chars:
    s = t2s.convert(u)
    if s != u and len(s) == 1:
        back.setdefault(s, set()).add(u)

out = {}
for c in chars:
    if c in GUARD or in_big5(c):
        continue
    trad = back.get(c)
    if not trad or len(trad) != 1:
        continue
    t = next(iter(trad))
    if s2t.convert(c) != t:
        continue
    j = t2jp.convert(t)
    if len(j) == 1 and j != c:
        out[c] = j

# 日本で通用する字体に合わせる微調整（Big5 にある字のうち日本の字体が違う字、OpenCC が旧字体を返す字）
out.update({'德': '徳', '厨': '厨'})
out = {k: v for k, v in out.items() if k != v}

path = os.path.join(ROOT, 'dict', 'charmap.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump({'_comment': 'tools/charmap.py が生成。簡体字1文字→日本の字体。辞書に無い文字列と星盤（SVG）の文字にだけ使う。', 'map': ''.join(k + v for k, v in sorted(out.items()))}, f, ensure_ascii=False, indent='\t')
    f.write('\n')
print(len(out), '字 ->', os.path.relpath(path))
for c in '马杀贞钺红鸾阴盖贪辅铃诰厨军德迁财禄权宫乡阳庙门后发台里干':
    print(c, out.get(c, '-'), end='  ')
print()
