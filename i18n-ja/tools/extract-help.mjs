// 解説（HelpDoc）コンポーネントを実際に描画し、翻訳単位（ブロック）を抜き出す。
//
// 使い方:
//   node i18n-ja/tools/extract-help.mjs <コンポーネントのパス> <出力JSON>
//   例: node i18n-ja/tools/extract-help.mjs Horosa-Web/astrostudyui/src/components/help/AstroHelpDoc.js i18n-ja/dict/help/astro.json
//
// 出力 JSON は [{ "src": 原文テンプレート, "ja": "" }, ...]。
// テンプレート中の ⟦i|文字列⟧ は「i 番目の子要素（太字・色付きラベル等）」を表す。
// 既存の出力ファイルがあれば、src が同じ項目の ja はそのまま引き継ぐ。
//
// 実行時エンジン（src/engine.js）と同じ規則でブロックを判定するので、
// ここで得た src からキー（normalize(textContent)）がそのまま一致する。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , compArg, outArg] = process.argv;
if(!compArg || !outArg){
	console.error('usage: extract-help.mjs <component.js> <out.json>');
	process.exit(2);
}
const compPath = path.resolve(compArg);
const outPath = path.resolve(outArg);

// antd の Tabs は非アクティブなタブを描画しないため、全タブを並べて描画する代替品に差し替える。
const antdShim = `
import { Children } from 'react';
const TabPane = ({ tab, children }) => <section data-tab="1"><h6 data-tab-label="1">{tab}</h6>{children}</section>;
export const Tabs = ({ children }) => <div>{children}</div>;
Tabs.TabPane = TabPane;
const passthrough = ({ children }) => <div>{children}</div>;
export const Collapse = passthrough; Collapse.Panel = ({ header, children }) => <section><h6>{header}</h6>{children}</section>;
export const Card = ({ title, children }) => <section>{title ? <h6>{title}</h6> : null}{children}</section>;
export const Table = () => null;
export const Tag = ({ children }) => <span>{children}</span>;
export const Divider = ({ children }) => <div>{children}</div>;
export const Typography = { Text: ({ children }) => <span>{children}</span>, Paragraph: ({ children }) => <p>{children}</p>, Title: ({ children }) => <div>{children}</div> };
export const Alert = ({ message, description }) => <div><div>{message}</div><div>{description}</div></div>;
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hja-'));
fs.writeFileSync(path.join(tmp, 'antd-shim.jsx'), antdShim);
fs.writeFileSync(path.join(tmp, 'entry.jsx'), `
import { renderToStaticMarkup } from 'react-dom/server';
import Comp from ${JSON.stringify(compPath)};
process.stdout.write(renderToStaticMarkup(<Comp />));
`);

const nodePaths = [path.join(here, 'node_modules')];
const result = esbuild.buildSync({
	entryPoints: [path.join(tmp, 'entry.jsx')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	write: false,
	jsx: 'automatic',
	loader: { '.js': 'jsx' },
	// React は必ず tools/ の 1 つだけを使う（アプリ側に node_modules があっても二重読み込みしない）。
	alias: { antd: path.join(tmp, 'antd-shim.jsx'), react: path.join(here, 'node_modules', 'react'), 'react-dom': path.join(here, 'node_modules', 'react-dom') },
	nodePaths,
	logLevel: 'error',
});
const bundlePath = path.join(tmp, 'bundle.cjs');
fs.writeFileSync(bundlePath, result.outputFiles[0].text);

const { execFileSync } = require('node:child_process');
const html = execFileSync(process.execPath, [bundlePath], {
	env: { ...process.env, NODE_PATH: nodePaths.join(path.delimiter) },
	maxBuffer: 64 * 1024 * 1024,
}).toString('utf8');

const { normalize, hasCjk, isBlockCandidate } = require(path.join(here, '..', 'src', 'shared.js'));
const dom = new JSDOM(`<body>${html}</body>`);
const { document, Node } = dom.window;

function templateOf(el){
	let out = '';
	let idx = 0;
	for(const ch of el.childNodes){
		if(ch.nodeType === Node.TEXT_NODE){
			out += ch.nodeValue;
		}else if(ch.nodeType === Node.ELEMENT_NODE){
			out += `⟦${idx}|${ch.textContent}⟧`;
			idx++;
		}
	}
	return out.replace(/\s+/g, ' ').trim();
}

const items = [];
const seen = new Set();
const tabLabels = new Set();
(function walk(el){
	for(const ch of el.children){
		if(ch.hasAttribute('data-tab-label')){
			tabLabels.add(ch.textContent.trim());
			continue;
		}
		if(isBlockCandidate(ch, Node)){
			const key = normalize(ch.textContent);
			if(!seen.has(key) && hasCjk(key)){
				seen.add(key);
				items.push(templateOf(ch));
			}
			continue;
		}
		walk(ch);
	}
})(document.body);

let prev = { blocks: [], tabs: {} };
if(fs.existsSync(outPath)){
	prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
}
const prevBySrc = new Map((prev.blocks || []).map((b)=>[b.src, b.ja]));
const prevTabs = prev.tabs || {};
const out = {
	component: path.relative(path.resolve(here, '..', '..'), compPath),
	tabs: Object.fromEntries([...tabLabels].map((t)=>[t, prevTabs[t] || ''])),
	blocks: items.map((src)=>({ src, ja: prevBySrc.get(src) || '' })),
};
fs.writeFileSync(outPath, JSON.stringify(out, null, '\t') + '\n');
const chars = items.join('').match(/[一-鿿]/g)?.length || 0;
console.log(`${out.component}: ${items.length} blocks, ${chars} CJK chars, ${tabLabels.size} tabs -> ${path.relative(process.cwd(), outPath)}`);
fs.rmSync(tmp, { recursive: true, force: true });
