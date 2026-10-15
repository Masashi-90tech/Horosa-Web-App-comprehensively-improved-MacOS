#!/usr/bin/env python3
"""未訳の表示文字列（extract-ui.mjs の結果）から、全画面用の辞書を生成する。

  python3 i18n-ja/tools/sweep.py

- dict/sweep/manual.tsv  : 手作業の訳（原文<TAB>訳）。訳が「-」なら変換しない。
- それ以外の30字以下の文字列: OpenCC（簡体→繁体→日本の新字体）で漢字だけを日本式にする。
  術数で字が化けると意味が変わる字（干・占・冲・斗・卜・丑・云）は変換しない。
出力（ビルドが読む）:
  dict/ui/80-sweep-manual.json, dict/ui/90-sweep-kanji.json
必要: pip install opencc
"""
import json, os, re, sys
import opencc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, 'build', 'ui-candidates.tsv')
MANUAL = os.path.join(ROOT, 'dict', 'sweep', 'manual.tsv')
MAXLEN = 30
GUARD = set('干占冲斗卜丑云')

s2t = opencc.OpenCC('s2t')
t2jp = opencc.OpenCC('t2jp')

def kanji_jp(s):
    out = t2jp.convert(s2t.convert(s))
    if len(out) != len(s):
        return s
    return ''.join(o if c not in GUARD else c for c, o in zip(s, out))

def norm(s):
    return re.sub(r'[\s　]+', '', s)

def load_existing():
    keys = set()
    d = os.path.join(ROOT, 'dict', 'ui')
    for f in os.listdir(d):
        if f.startswith(('80-', '90-')) or not f.endswith('.json'):
            continue
        for sec, m in json.load(open(os.path.join(d, f), encoding='utf-8')).items():
            if not sec.startswith('_'):
                keys.update(norm(k) for k in m)
    h = os.path.join(ROOT, 'dict', 'help')
    for f in os.listdir(h):
        if f.endswith('.json'):
            keys.update(norm(k) for k in json.load(open(os.path.join(h, f), encoding='utf-8')).get('tabs', {}))
    return keys

def main():
    manual = {}
    if os.path.exists(MANUAL):
        for line in open(MANUAL, encoding='utf-8'):
            line = line.rstrip('\n')
            if not line or line.startswith('#') or '\t' not in line:
                continue
            zh, ja = line.split('\t', 1)
            manual[zh] = ja
    existing = load_existing()
    rows = [l.rstrip('\n').split('\t') for l in open(CAND, encoding='utf-8') if l.strip()]
    man_out, kanji_out = {}, {}
    seen = set()
    for _, s, f in rows:
        k = norm(s)
        if k in existing or k in seen:
            continue
        seen.add(k)
        area = '/'.join(f.split('/')[:2])
        if s in manual:
            if manual[s] != '-':
                man_out.setdefault(area, {})[s] = manual[s]
            continue
        if len(s) > MAXLEN:
            continue
        j = kanji_jp(s)
        if j != s:
            kanji_out.setdefault(area, {})[s] = j
    # manual にあって候補に無いもの（抽出条件の外で拾った文字列）も入れる
    for zh, ja in manual.items():
        k = norm(zh)
        if k not in seen and k not in existing and ja != '-':
            man_out.setdefault('(手動追加)', {})[zh] = ja
            seen.add(k)
    def dump(path, about, data):
        obj = {'_about': about}
        obj.update({k: data[k] for k in sorted(data)})
        with open(path, 'w', encoding='utf-8') as fp:
            json.dump(obj, fp, ensure_ascii=False, indent='\t')
            fp.write('\n')
    dump(os.path.join(ROOT, 'dict', 'ui', '80-sweep-manual.json'),
         '自動生成（tools/sweep.py）。全画面の表示文字列を洗い出し、手作業で訳したもの（dict/sweep/manual.tsv）。セクションは主な出現箇所。', man_out)
    dump(os.path.join(ROOT, 'dict', 'ui', '90-sweep-kanji.json'),
         '自動生成（tools/sweep.py）。手作業で訳していない30字以下の表示文字列を、漢字だけ日本の字形にしたもの（OpenCC）。占断の本文・術語は意味を変えないためこの扱い。', kanji_out)
    print(f'手作業 {sum(map(len, man_out.values()))} 件, 漢字変換 {sum(map(len, kanji_out.values()))} 件')

if __name__ == '__main__':
    main()
