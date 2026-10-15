// 「番号<TAB>訳文」形式のファイルを解説辞書 JSON に取り込む。
//   node i18n-ja/tools/merge-tsv.mjs dict/help/astro.json 訳.tsv [訳2.tsv ...]
// 訳文中の ⟦n|…⟧ が原文に存在する番号かを検査し、原文にある番号が訳で抜けていれば警告する。
import fs from 'node:fs';

const [, , jsonPath, ...tsvs] = process.argv;
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const MARK = /⟦(\d+)\|[^⟧]*⟧/g;
const idx = (s)=>new Set([...s.matchAll(MARK)].map((m)=>m[1]));
let n = 0;
let bad = 0;
for(const f of tsvs){
	for(const line of fs.readFileSync(f, 'utf8').split('\n')){
		if(!line.trim()){
			continue;
		}
		const tab = line.indexOf('\t');
		const i = Number(line.slice(0, tab));
		const ja = line.slice(tab + 1).trim();
		const b = data.blocks[i];
		if(!b || tab < 0){
			console.error(`${f}: 番号が不正: ${line.slice(0, 30)}`);
			bad++;
			continue;
		}
		const s = idx(b.src);
		const t = idx(ja);
		for(const k of t){
			if(!s.has(k)){
				console.error(`#${i}: 原文に無い ⟦${k}|…⟧`);
				bad++;
			}
		}
		for(const k of s){
			if(!t.has(k)){
				console.warn(`#${i}: 原文の ⟦${k}|…⟧ が訳に無い（その装飾は表示されない）`);
			}
		}
		b.ja = ja;
		n++;
	}
}
if(bad){
	process.exit(1);
}
fs.writeFileSync(jsonPath, JSON.stringify(data, null, '\t') + '\n');
const done = data.blocks.filter((b)=>b.ja).length;
console.log(`${n} 件取り込み · ${done}/${data.blocks.length} 段落が翻訳済み`);
