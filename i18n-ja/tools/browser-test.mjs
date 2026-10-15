// 実ブラウザ（Chromium）で、本物の React 17 + antd 4（アプリと同じ版）を描画し、
// パッチが「表示だけを変え、React を壊さない」ことを確かめる。
//
//   node i18n-ja/tools/browser-test.mjs [スクリーンショット出力先ディレクトリ]
//
// 前提: tools/ で npm install 済み、かつ playwright-core と Chromium が使えること。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..');
const shotDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'hja-shots'));
fs.mkdirSync(shotDir, { recursive: true });

const app = `
import { useState } from 'react';
import ReactDOM from 'react-dom';
import { ConfigProvider, Button, Modal, DatePicker, Input, Tabs, Select } from 'antd';
import zhCN from 'antd/es/locale/zh_CN';
import moment from 'moment';
import 'moment/locale/zh-cn';
moment.locale('zh-cn');
import 'antd/dist/antd.css';
import AstroHelpDoc from ${JSON.stringify(path.join(repo, 'Horosa-Web/astrostudyui/src/components/help/AstroHelpDoc.js'))};

function NavTab({ label, group }){
	return (
		<span className="horosa-main-tab-label" title={label} aria-label={label}>
			<span className="horosa-main-tab-copy">
				{group ? <span className="horosa-main-tab-group">{group}</span> : null}
				<span className="horosa-main-tab-text">{label}</span>
			</span>
		</span>
	);
}

function App(){
	const [n, setN] = useState(0);
	const [help, setHelp] = useState(false);
	const [show, setShow] = useState(true);
	const status = n % 2 === 0 ? '加载中…' : '完成';
	const para = n % 2 === 0
		? <p id="para">本页排<b>本命盘</b>(出生时刻的天宫图):录入出生时间与地点,选定黄道、分宫制等参数后,中央绘出星盘,右栏分标签给出信息、相位、行星、古典尊贵、可能性与格局判读。</p>
		: <p id="para">这一段不在辞典里<b>所以</b>应保持中文。</p>;
	return (
		<ConfigProvider locale={zhCN}>
			<div id="nav">
				<NavTab label="占星" group="命" />
				<NavTab label="八字" group="命" />
				<NavTab label="AI分析" group="工具" />
			</div>
			<div id="status">{status}</div>
			{para}
			<div id="untouched">
				<span id="ziwei-xian">陷</span>
				<span id="ganzhi">甲子</span>
				<svg width="80" height="20"><text id="svgtext" x="0" y="15">白羊</text></svg>
				<div id="editor" contentEditable suppressContentEditableWarning>取消</div>
				<input id="inp" placeholder="请输入" defaultValue="取消" />
			</div>
			<Button id="ok" type="primary">确定</Button>
			<Button id="cancel">取消</Button>
			<Button id="next" onClick={()=>setN(n + 1)}>{'切换' + n}</Button>
			<Button id="help" onClick={()=>setHelp(true)}>帮助</Button>
			<Button id="toggle" onClick={()=>setShow(!show)}>toggle</Button>
			{show ? <div id="mounted"><span>星盘设置</span><span>显示星体</span></div> : null}
			<DatePicker id="dp" open={n === 3} />
			<Select id="sel" style={{ width: 160 }} defaultValue="0" options={[{ value: '0', label: '整宫制' }, { value: '1', label: 'Placidus' }]} />
			<Modal title="帮助" visible={help} onCancel={()=>setHelp(false)} width={760} footer={null}>
				<AstroHelpDoc />
			</Modal>
		</ConfigProvider>
	);
}
ReactDOM.render(<App />, document.getElementById('root'));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hja-bt-'));
fs.writeFileSync(path.join(tmp, 'app.jsx'), app);
esbuild.buildSync({
	entryPoints: [path.join(tmp, 'app.jsx')],
	bundle: true,
	outdir: tmp,
	jsx: 'automatic',
	loader: { '.js': 'jsx' },
	nodePaths: [path.join(here, 'node_modules')],
	define: { 'process.env.NODE_ENV': '"development"' },
	logLevel: 'error',
});
fs.mkdirSync(path.join(tmp, 'horosa-i18n'));
fs.copyFileSync(path.join(root, 'patch', 'horosa-i18n', 'horosa-ja.js'), path.join(tmp, 'horosa-i18n', 'horosa-ja.js'));
fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>星阙</title><link rel="icon" href="data:,"><link rel="stylesheet" href="./app.css">
<script src="./horosa-i18n/horosa-ja.js" data-horosa-ja="1"></script>
</head>
<body><div id="root"></div><script src="./app.js"></script></body></html>`);

const server = http.createServer((req, res)=>{
	const f = path.join(tmp, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
	if(!fs.existsSync(f)){ res.writeHead(404); res.end(); return; }
	const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html';
	const headers = { 'Content-Type': type + '; charset=utf-8' };
	if(type === 'text/html'){
		// デスクトップ版のローカルサーバー（Horosa_Desktop_Installer/src-tauri/src/main.rs）と同じ CSP。
		headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.amap.com; style-src 'self' 'unsafe-inline' https://*.amap.com; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'self'";
	}
	res.writeHead(200, headers);
	fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const results = [];
function check(name, ok, detail){
	results.push({ name, ok, detail });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const consoleErrors = [];
page.on('console', (m)=>{ if(m.type() === 'error'){ consoleErrors.push(m.text()); } });
page.on('pageerror', (e)=>consoleErrors.push(String(e)));

const txt = (sel)=>page.$eval(sel, (el)=>el.textContent);
// 画面に実際に見える文字（パッチが隠した原文は除く）。innerText は文字サイズ 0 の原文も拾うため使わない。
const visible = (sel)=>page.$eval(sel, (root)=>{
	const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let out = '';
	let n;
	while((n = w.nextNode())){
		const el = n.parentElement;
		if(el.closest('[data-hja-block]') && !el.closest('[data-hja-tr]')){ continue; }
		if(el.closest('[style*="display: none"]') || getComputedStyle(el).display === 'none'){ continue; }
		out += n.nodeValue;
	}
	return out.replace(/\s+/g, ' ').trim();
});

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForSelector('#nav');

check('ナビ: 占星 → 西洋占星', (await txt('#nav .horosa-main-tab-label:nth-child(1) .horosa-main-tab-text')) === '西洋占星');
check('ナビ: title 属性も訳す', (await page.$eval('#nav .horosa-main-tab-label:nth-child(2)', (el)=>el.getAttribute('title'))) === '四柱推命');
check('ナビ: グループ「工具」→ツール（範囲限定）', (await txt('#nav .horosa-main-tab-label:nth-child(3) .horosa-main-tab-group')) === 'ツール');
check('ナビ: グループ「命」は1文字なので触らない', (await txt('#nav .horosa-main-tab-label:nth-child(1) .horosa-main-tab-group')) === '命');
check('antd ボタン「确 定」→ OK', (await visible('#ok')) === 'OK');
check('antd ボタン「取 消」→ キャンセル', (await visible('#cancel')) === 'キャンセル');
check('状態テキスト', (await txt('#status')) === '読み込み中…');
check('解説段落を重ねて表示', (await visible('#para')).startsWith('このページでは出生図') && (await page.$eval('#para', (el)=>el.hasAttribute('data-hja-block'))), await visible('#para'));
check('重ねた訳文で太字を保つ', (await page.$eval('#para [data-hja-tr] b', (el)=>el.textContent)) === '出生図');
check('紫微の「陷」は訳さない', (await txt('#ziwei-xian')) === '陷');
check('干支は訳さない', (await txt('#ganzhi')) === '甲子');
check('SVG 内は訳さない', (await txt('#svgtext')) === '白羊');
check('編集可能領域は訳さない', (await txt('#editor')) === '取消');
check('入力値は訳さない', (await page.$eval('#inp', (el)=>el.value)) === '取消');
check('placeholder は訳す', (await page.$eval('#inp', (el)=>el.placeholder)) === '入力してください');
check('Select の表示ラベル', (await visible('.ant-select-selection-item')) === 'ホールサイン', await visible('.ant-select-selection-item'));
check('<html lang="ja">', (await page.$eval('html', (el)=>el.lang)) === 'ja');
check('ページタイトル', (await page.title()) === '星闕', await page.title());

// React の再描画（状態変化）
await page.click('#next');
check('再描画: 状態テキストが変わっても訳す', (await txt('#status')) === '完了');
check('再描画: 段落が辞書外になったら原文に戻る', (await visible('#para')) === '这一段不在辞典里所以应保持中文。', await visible('#para'));
await page.click('#next');
check('再描画: 段落が辞書内に戻ったら再び訳す', (await visible('#para')).includes('出生図'), await visible('#para'));
check('再描画: ボタン内の数字入りテキストは原文のまま動く', (await visible('#next')) === '切换2');
// アンマウント/再マウント
await page.click('#toggle');
await page.click('#toggle');
check('再マウント後も訳す', (await txt('#mounted')) === 'チャート設定表示する天体');

// DatePicker の曜日（範囲限定の辞書）
await page.click('#next');
await page.waitForSelector('.ant-picker-content th');
const ths = await page.$$eval('.ant-picker-content th', (els)=>els.map((e)=>e.textContent).join(''));
check('DatePicker の曜日', ths === '月火水木金土日', ths);
const today = await page.$$eval('.ant-picker-today-btn', (els)=>els.map((e)=>e.textContent).join(''));
check('DatePicker「今天」', today === '今日', today);
await page.screenshot({ path: path.join(shotDir, 'datepicker.png') });

// 解説モーダル（実物の AstroHelpDoc、antd Tabs）
await page.click('#next');
await page.click('#help');
await page.waitForSelector('.ant-modal-body .ant-tabs');
await page.waitForTimeout(300);
const modalTitle = await visible('.ant-modal-title');
check('モーダルタイトル', modalTitle === 'ヘルプ', modalTitle);
const tabNames = await page.$$eval('.ant-modal-body .ant-tabs-tab', (els)=>els.map((e)=>e.innerText.trim()));
const stats0 = await page.evaluate(()=>({ ...window.__HOROSA_I18N__.stats }));
await page.screenshot({ path: path.join(shotDir, 'help-overview.png') });
// タブを順に開く（非表示タブは後から描画される＝MutationObserver 経由の翻訳）
const clickTab = (i)=>page.evaluate((k)=>document.querySelectorAll('.ant-modal-body .ant-tabs-tab')[k].click(), i);
for(let i = 0; i < tabNames.length; i++){
	await clickTab(i);
	await page.waitForTimeout(120);
}
await clickTab(1);
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shotDir, 'help-settings.png') });
// 解説内で未翻訳の段落数（訳が埋まっていれば 0 に近づく）
const residual = await page.$$eval('.ant-modal-body .ant-tabs-tabpane', (panes)=>{
	const CJK = /[\\u4e00-\\u9fff]/;
	let left = 0;
	let total = 0;
	for(const pane of panes){
		const w = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
		let n;
		while((n = w.nextNode())){
			const el = n.parentElement;
			if(!CJK.test(n.nodeValue) || el.closest('[data-hja-block]') && !el.closest('[data-hja-tr]')){
				continue;
			}
			total++;
			if(/[\\u3040-\\u30ff]/.test(n.nodeValue) === false && /[们这说时间录黄宫盘设显导择应该还没开关问题对体经项内单页栏宫选择则]/.test(n.nodeValue)){
				left++;
			}
		}
	}
	return { left, total };
});
const stats1 = await page.evaluate(()=>({ ...window.__HOROSA_I18N__.stats }));
check('React のエラー・例外なし', consoleErrors.filter((e)=>!/Warning:/.test(e)).length === 0, consoleErrors.join('\n').slice(0, 800));

// 中国語へ切り替え → 原文表示
await page.keyboard.press('Escape');
await page.click('#hja-switch');
await page.waitForLoadState('load');
await page.waitForSelector('#nav');
check('中国語に切替: ナビが原文', (await txt('#nav .horosa-main-tab-label:nth-child(1) .horosa-main-tab-text')) === '占星');
check('中国語に切替: 切替ボタンは「日本語」', (await txt('#hja-switch')) === '日本語');
await page.click('#hja-switch');
await page.waitForLoadState('load');
await page.waitForSelector('#nav');
check('日本語に戻す', (await txt('#nav .horosa-main-tab-label:nth-child(1) .horosa-main-tab-text')) === '西洋占星');

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
for(const r of results){
	if(!r.ok){ failed++; }
	console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? '\n      → ' + r.detail : ''}`);
}
console.log(`\n解説タブ: ${tabNames.join(' / ')}`);
console.log(`置換数: 初回 ${JSON.stringify(stats0)} → 全タブ表示後 ${JSON.stringify(stats1)}`);
console.log(`解説内の未翻訳らしきテキスト: ${residual.left} / ${residual.total}`);
console.log(`スクリーンショット: ${shotDir}`);
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
