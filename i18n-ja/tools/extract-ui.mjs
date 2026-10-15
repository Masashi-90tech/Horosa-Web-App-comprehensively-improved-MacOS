// フロントエンドのソースを構文解析し、「画面に表示される中国語の文字列」を集める。
//
//   node i18n-ja/tools/extract-ui.mjs [出力TSV]
//
// 対象: JSX のテキスト、表示用の JSX 属性（title / label / placeholder …）、
//       表示用のオブジェクトのキー（label: / title: / content: …）の値、JSX 中の文字列式、
//       message.* / notification.* / alert / confirm の引数。
// 除外: 比較（=== など）・case・オブジェクトのキー・console / Error の文字列など、計算や内部処理用のもの。
//       テスト、解説ページ（*HelpDoc.js）、${} を含むテンプレート文字列（実行時に組み立てられるため一致しない）。
//
// 出力 TSV: 出現ファイル数 <TAB> 原文 <TAB> 代表ファイル（既に辞書にあるものは出さない）

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { normalize, hasCjk } = require(path.join(root, 'src', 'shared.js'));

const SRC = path.join(repo, 'Horosa-Web', 'astrostudyui', 'src');
const out = process.argv[2] || path.join(root, 'build', 'ui-candidates.tsv');

const UI_ATTRS = new Set(['title', 'label', 'placeholder', 'tab', 'okText', 'cancelText', 'message', 'description',
	'content', 'tooltip', 'header', 'extra', 'addonBefore', 'addonAfter', 'help', 'text', 'desc', 'tip', 'emptyText',
	'checkedChildren', 'unCheckedChildren', 'aria-label', 'alt', 'children', 'subTitle', 'subtitle', 'caption', 'hint',
	'note', 'summary', 'prefix', 'suffix', 'name', 'buttonText', 'confirmText', 'heading', 'legend', 'unit', 'options']);
const UI_KEYS = new Set(['label', 'title', 'text', 'desc', 'description', 'placeholder', 'tip', 'tooltip', 'message',
	'content', 'header', 'tab', 'okText', 'cancelText', 'emptyText', 'hint', 'note', 'caption', 'subtitle', 'subTitle',
	'summary', 'heading', 'name', 'group', 'groupLabel', 'short', 'shortLabel', 'full', 'fullLabel', 'display',
	'displayName', 'help', 'unit', 'legend', 'btnText', 'buttonText', 'confirmText', 'detail', 'brief', 'badge', 'tag',
	// 選択肢・一覧の短縮キー（{ v: 'x', l: '表示名' } など）と、タロット等の意味（up / rev）
	'l', 'lbl', 'cn', 'zh', 'up', 'rev', 'lo', 'mean', 'meaning', 'when', 'then', 'def', 'pt', 'jx', 'role', 'dir', 'keywords', 'kw']);
// 表示用の行・欄を作るヘルパー関数（kv('ラベル', 値)、sel('ラベル', key, 選択肢) など）。文字列の引数を拾う。
const LABEL_CALLS = /^(kv|row|card|sel|segField|field|numField|cell|mk|ana|mainTab|renderMoiraSection|need|section|item|tag|badge|chip|line|kvRow|infoRow|stat|pill|opt|option|label|th|td|li|para|note|hint|tip)$/;
const NOTIFY_OBJS = new Set(['message', 'notification', 'Modal']);

const stats = new Map();
function add(raw, file){
	const s = String(raw).replace(/\s+/g, ' ').trim();
	if(!s || !hasCjk(s) || s.length > 120){
		return;
	}
	const key = normalize(s);
	if([...key].filter((c)=>/[一-鿿]/.test(c)).length < 2){
		return; // 1文字の語は全画面に効く辞書には入れない
	}
	let e = stats.get(s);
	if(!e){
		e = { files: new Set(), n: 0 };
		stats.set(s, e);
	}
	e.files.add(file);
	e.n++;
}

function literalValue(node){
	if(!node){ return null; }
	if(node.type === 'StringLiteral'){ return node.value; }
	if(node.type === 'TemplateLiteral' && node.expressions.length === 0){ return node.quasis[0].value.cooked; }
	return null;
}

// 条件式・論理式の中の文字列も拾う（{ok ? '完成' : '加载中…'}）
function collectFromExpr(node, file){
	if(!node){ return; }
	const v = literalValue(node);
	if(v != null){ add(v, file); return; }
	if(node.type === 'ConditionalExpression'){
		collectFromExpr(node.consequent, file);
		collectFromExpr(node.alternate, file);
	}else if(node.type === 'LogicalExpression'){
		collectFromExpr(node.right, file);
		if(node.operator !== '&&'){ collectFromExpr(node.left, file); }
	}else if(node.type === 'ArrayExpression'){
		node.elements.forEach((el)=>el && el.type !== 'ObjectExpression' && collectFromExpr(el, file));
	}
}

function keyName(k){
	if(!k){ return null; }
	if(k.type === 'Identifier'){ return k.name; }
	if(k.type === 'StringLiteral'){ return k.value; }
	return null;
}

function walk(dir, files){
	for(const name of fs.readdirSync(dir)){
		const p = path.join(dir, name);
		const st = fs.statSync(p);
		if(st.isDirectory()){
			if(name === '__tests__' || name === 'fixtures' || name === 'test'){ continue; }
			walk(p, files);
		}else if(/\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name) && !/HelpDoc\.js$/.test(name)){
			files.push(p);
		}
	}
	return files;
}

const files = walk(SRC, []);
let failed = 0;
for(const f of files){
	const code = fs.readFileSync(f, 'utf8');
	if(!/[一-鿿]/.test(code)){ continue; }
	const rel = path.relative(SRC, f);
	let ast;
	try{
		ast = parse(code, {
			sourceType: 'unambiguous',
			errorRecovery: true,
			plugins: ['jsx', 'classProperties', 'classPrivateProperties', 'optionalChaining', 'nullishCoalescingOperator',
				'objectRestSpread', 'dynamicImport', 'exportDefaultFrom', 'decorators-legacy', /\.tsx?$/.test(f) ? 'typescript' : 'flow'],
		});
	}catch(e){
		failed++;
		continue;
	}
	traverse(ast, {
		JSXText(p){
			add(p.node.value, rel);
		},
		JSXAttribute(p){
			const name = p.node.name && (p.node.name.name || (p.node.name.namespace && p.node.name.name.name));
			if(!UI_ATTRS.has(name)){ return; }
			const v = p.node.value;
			if(!v){ return; }
			if(v.type === 'StringLiteral'){ add(v.value, rel); }
			else if(v.type === 'JSXExpressionContainer'){ collectFromExpr(v.expression, rel); }
		},
		JSXExpressionContainer(p){
			if(p.parent.type === 'JSXAttribute'){ return; }
			collectFromExpr(p.node.expression, rel);
		},
		ObjectProperty(p){
			const k = keyName(p.node.key);
			if(k && UI_KEYS.has(k)){ collectFromExpr(p.node.value, rel); }
		},
		CallExpression(p){
			const c = p.node.callee;
			let hit = false;
			if(c.type === 'MemberExpression' && c.object.type === 'Identifier' && NOTIFY_OBJS.has(c.object.name)){ hit = true; }
			if(c.type === 'Identifier' && /^(alert|confirm|showMessage|toast|notify|setError|setStatus|setTip|setHint)$/.test(c.name)){ hit = true; }
			if(hit){ p.node.arguments.forEach((a)=>collectFromExpr(a, rel)); }
		},
	});
}

// 既存の辞書に入っているものは除く
const known = new Set();
for(const f of fs.readdirSync(path.join(root, 'dict', 'ui'))){
	const d = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'ui', f), 'utf8'));
	for(const [sec, map] of Object.entries(d)){
		if(!sec.startsWith('_')){ Object.keys(map).forEach((k)=>known.add(normalize(k))); }
	}
}
const rows = [...stats.entries()]
	.filter(([s])=>!known.has(normalize(s)))
	.sort((a, b)=>b[1].files.size - a[1].files.size || b[1].n - a[1].n || a[0].length - b[0].length);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rows.map(([s, e])=>`${e.files.size}\t${s}\t${[...e.files][0]}`).join('\n') + '\n');
const chars = rows.reduce((a, [s])=>a + s.length, 0);
console.log(`${files.length} ファイル（解析失敗 ${failed}）→ 未訳の表示文字列 ${rows.length} 種類（計 ${chars} 字） -> ${path.relative(process.cwd(), out)}`);
