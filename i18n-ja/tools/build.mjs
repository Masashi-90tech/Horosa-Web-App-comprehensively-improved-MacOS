// 辞書（dict/）とエンジン（src/）から、配布用の 1 ファイル patch/horosa-i18n/horosa-ja.js を作る。
//
//   node i18n-ja/tools/build.mjs
//
// 検査（どれかに引っかかるとビルド失敗）:
//   - 同じ原文キーに異なる訳が登録されている
//   - 解説の訳文が原文に無い子要素番号 ⟦n|…⟧ を参照している

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { normalize, hasCjk } = require(path.join(root, 'src', 'shared.js'));

const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
const errors = [];
const warnings = [];

const text = {};
const textOrigin = {};
function addText(zh, ja, origin){
	const key = normalize(zh);
	if(!key || ja === '' || ja == null){
		return;
	}
	if(Object.prototype.hasOwnProperty.call(text, key) && text[key] !== ja){
		errors.push(`訳の衝突: 「${zh}」 = 「${text[key]}」(${textOrigin[key]}) / 「${ja}」(${origin})`);
		return;
	}
	text[key] = ja;
	textOrigin[key] = origin;
}

// ── UI 辞書 dict/ui/*.json : { "セクション名": { "中文": "日本語" } } ──
const uiDir = path.join(root, 'dict', 'ui');
for(const f of fs.readdirSync(uiDir).filter((n)=>n.endsWith('.json')).sort()){
	const data = JSON.parse(fs.readFileSync(path.join(uiDir, f), 'utf8'));
	for(const [section, map] of Object.entries(data)){
		if(section.startsWith('_')){
			continue;
		}
		for(const [zh, ja] of Object.entries(map)){
			addText(zh, ja, `${f}#${section}`);
		}
	}
}

// ── 範囲限定の辞書 dict/scoped.json : [{ selector, map }] ──
const scoped = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'scoped.json'), 'utf8'))
	.filter((s)=>!s._comment)
	.map((s)=>({ selector: s.selector, map: Object.fromEntries(Object.entries(s.map).map(([zh, ja])=>[normalize(zh), ja])) }));

// ── 正規表現の置換 dict/patterns.json : [{ re, to }]（キーは空白除去後の文字列に対して照合）──
const patterns = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'patterns.json'), 'utf8'))
	.filter((p)=>!p._comment)
	.map((p)=>{
		new RegExp(p.re);
		return [p.re, p.to];
	});

// ── 解説 dict/help/*.json ──
const MARK_RE = /⟦(\d+)\|([^⟧]*)⟧/g;
function compileTemplate(tpl){
	const out = [];
	let last = 0;
	for(const m of tpl.matchAll(MARK_RE)){
		if(m.index > last){
			out.push(tpl.slice(last, m.index));
		}
		out.push([Number(m[1]), m[2]]);
		last = m.index + m[0].length;
	}
	if(last < tpl.length){
		out.push(tpl.slice(last));
	}
	return out.length ? out : [''];
}
function plainOf(tpl){
	return tpl.replace(MARK_RE, (_, __, t)=>t);
}
function indicesOf(tpl){
	return new Set([...tpl.matchAll(MARK_RE)].map((m)=>Number(m[1])));
}

const blocks = {};
const helpStats = [];
const helpDir = path.join(root, 'dict', 'help');
for(const f of fs.readdirSync(helpDir).filter((n)=>n.endsWith('.json')).sort()){
	const data = JSON.parse(fs.readFileSync(path.join(helpDir, f), 'utf8'));
	let done = 0;
	for(const [zh, ja] of Object.entries(data.tabs || {})){
		addText(zh, ja, `help/${f}#tabs`);
	}
	for(const b of data.blocks){
		if(!b.ja){
			continue;
		}
		const srcIdx = indicesOf(b.src);
		for(const i of indicesOf(b.ja)){
			if(!srcIdx.has(i)){
				errors.push(`help/${f}: 訳文が存在しない子要素 ⟦${i}|…⟧ を参照: ${b.src.slice(0, 40)}…`);
			}
		}
		const key = normalize(plainOf(b.src));
		const tpl = compileTemplate(b.ja);
		if(blocks[key] && JSON.stringify(blocks[key]) !== JSON.stringify(tpl)){
			warnings.push(`help/${f}: 同じ原文に別の訳（後勝ち）: ${b.src.slice(0, 40)}…`);
		}
		blocks[key] = tpl;
		done++;
	}
	helpStats.push(`${f}: ${done}/${data.blocks.length} 段落`);
}

if(errors.length){
	console.error(errors.join('\n'));
	process.exit(1);
}

// ── 1文字ずつの字体変換表 dict/charmap.json（tools/charmap.py が生成）──
const charmap = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'charmap.json'), 'utf8')).map;

const keys = Object.keys(blocks);
const data = {
	version: VERSION,
	text,
	blocks,
	scoped,
	patterns,
	charmap,
	blockMinLen: keys.length ? Math.min(...keys.map((k)=>k.length)) : 1,
	blockMaxLen: keys.length ? Math.max(...keys.map((k)=>k.length)) : 0,
};
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'data.json'), JSON.stringify(data));

const banner = `/*! Horosa 日本語表示パッチ v${VERSION} — 表示文字のみを置き換えます（計算・データには触れません）。
 *  ソース: i18n-ja/（AGPL-3.0-only、本体と同じライセンス） */`;
const outFile = path.join(root, 'patch', 'horosa-i18n', 'horosa-ja.js');
esbuild.buildSync({
	entryPoints: [path.join(root, 'src', 'engine.js')],
	bundle: true,
	format: 'iife',
	target: ['safari13'],
	charset: 'utf8',
	banner: { js: banner },
	outfile: outFile,
	logLevel: 'error',
});
fs.writeFileSync(path.join(root, 'patch', 'horosa-i18n', 'VERSION'), VERSION + '\n');

// ── 用語対照表 GLOSSARY.md（辞書から自動生成。手で編集しない）──
const md = ['# 用語対照表（自動生成）', '', '`node i18n-ja/tools/build.mjs` で `dict/` から生成しています。訳語を直すときは `dict/` の JSON を編集してください。', ''];
for(const f of fs.readdirSync(uiDir).filter((n)=>n.endsWith('.json')).sort()){
	const d = JSON.parse(fs.readFileSync(path.join(uiDir, f), 'utf8'));
	md.push(`## ${f.replace(/^\d+-|\.json$/g, '')}`, '');
	if(d._about){ md.push(d._about, ''); }
	for(const [section, map] of Object.entries(d)){
		if(section.startsWith('_')){ continue; }
		md.push(`### ${section}`, '', '| 中文（原文） | 日本語 |', '|---|---|');
		for(const [zh, ja] of Object.entries(map)){ md.push(`| ${zh} | ${ja} |`); }
		md.push('');
	}
}
md.push('## 範囲限定（scoped.json）', '', '| 対象（CSSセレクタ） | 中文 | 日本語 |', '|---|---|---|');
for(const sc of JSON.parse(fs.readFileSync(path.join(root, 'dict', 'scoped.json'), 'utf8')).filter((x)=>!x._comment)){
	for(const [zh, ja] of Object.entries(sc.map)){ md.push(`| \`${sc.selector}\` | ${zh} | ${ja} |`); }
}
md.push('');
for(const f of fs.readdirSync(helpDir).filter((n)=>n.endsWith('.json')).sort()){
	const d = JSON.parse(fs.readFileSync(path.join(helpDir, f), 'utf8'));
	md.push(`## 解説タブ（help/${f}）`, '', '| 中文 | 日本語 |', '|---|---|');
	for(const [zh, ja] of Object.entries(d.tabs || {})){ md.push(`| ${zh} | ${ja} |`); }
	md.push('');
}
fs.writeFileSync(path.join(root, 'GLOSSARY.md'), md.join('\n'));

for(const w of warnings){
	console.warn('warn:', w);
}
const untranslatedCjk = Object.values(text).filter((v)=>hasCjk(v)).length;
console.log(`v${VERSION}: UI ${Object.keys(text).length} 語（うち漢字を含む訳 ${untranslatedCjk}）, 範囲限定 ${scoped.length} 組, 置換規則 ${patterns.length}, 解説 ${keys.length} 段落, 字体変換 ${charmap.length / 2} 字`);
for(const s of helpStats){
	console.log('  ' + s);
}
console.log(`-> ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
