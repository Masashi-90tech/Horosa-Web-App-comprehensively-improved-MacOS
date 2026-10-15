// 本物の Horosa フロントエンド（npm run build:file の dist-file）にパッチを当てて Chromium で開く確認。
// 計算サーバーは起動しないので、チャート計算は失敗表示になる前提。UI（ナビ・上部バー・ヘルプ）を確認する。
//
//   node i18n-ja/tools/app-smoke.mjs <dist-file のパス> [スクリーンショット出力先]
//
// dist-file はコピーしてからパッチを当てるので、元のビルド結果は変更しない。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distSrc = path.resolve(process.argv[2] || '');
const shotDir = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'hja-app'));
if(!fs.existsSync(path.join(distSrc, 'index.html'))){
	console.error('usage: app-smoke.mjs <dist-file> [shots]');
	process.exit(2);
}
fs.mkdirSync(shotDir, { recursive: true });

// インストーラが前提とするフォルダ構成を再現し、本物のインストーラでパッチを当てる。
const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'hja-rt-'));
const dist = path.join(rt, 'current', 'Horosa-Web', 'astrostudyui', 'dist-file');
fs.mkdirSync(path.dirname(dist), { recursive: true });
fs.cpSync(distSrc, dist, { recursive: true });
// 配布版と同じく、4KB を超える html/js/css に .gz の圧縮版を置く（package_runtime_payload.sh の [B2]）。
const zlib = require('node:zlib');
for(const name of fs.readdirSync(dist)){
	const f = path.join(dist, name);
	if(/\.(html|js|css)$/.test(name) && fs.statSync(f).size > 4096){
		fs.writeFileSync(f + '.gz', zlib.gzipSync(fs.readFileSync(f), { level: 9 }));
	}
}
execFileSync('bash', [path.join(root, 'install_ja_patch.command'), path.join(rt, 'current')], { stdio: 'inherit' });

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.amap.com; style-src 'self' 'unsafe-inline' https://*.amap.com; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'self'";
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
// デスクトップ版の静態サーバーと同じく、存在しないパスは index.html を返す。
const server = http.createServer((req, res)=>{
	if(req.method !== 'GET' && req.method !== 'HEAD'){
		res.writeHead(503, { 'Content-Type': 'application/json' });
		res.end('{"msg":"stub backend (smoke test)"}');
		return;
	}
	const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
	let f = path.join(dist, rel);
	if(!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
		f = path.join(dist, 'index.html');
	}
	const type = MIME[path.extname(f)] || 'application/octet-stream';
	const headers = { 'Content-Type': type };
	// デスクトップ版と同じく、gzip を受け付けるクライアントには .gz の圧縮版を優先して返す。
	if(/gzip/.test(req.headers['accept-encoding'] || '') && fs.existsSync(f + '.gz')){
		f = f + '.gz';
		headers['Content-Encoding'] = 'gzip';
	}
	if(type === 'text/html'){ headers['Content-Security-Policy'] = CSP; }
	res.writeHead(200, headers);
	fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e)=>errors.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', (m)=>{ if(m.type() === 'error'){ errors.push('console: ' + m.text().slice(0, 200)); } });

const t0 = Date.now();
// srv= をこのサーバーに向けると、起動ゲート（/heartbeat に何か応答があれば通過）を抜けてメイン画面が出る。
await page.goto(`http://127.0.0.1:${port}/index.html?srv=${encodeURIComponent(`http://127.0.0.1:${port}`)}`);
await page.waitForTimeout(12000);
const loadMs = Date.now() - t0;
await page.screenshot({ path: path.join(shotDir, 'app-ja.png') });

const info = await page.evaluate(()=>{
	const api = window.__HOROSA_I18N__;
	const tabs = Array.from(document.querySelectorAll('.horosa-main-tab-text')).map((e)=>e.textContent);
	const groups = Array.from(document.querySelectorAll('.horosa-main-tab-group')).map((e)=>e.textContent);
	// 画面に残っている中国語テキスト（SVG・入力欄・隠した原文を除く）の上位
	const CJK = /[一-鿿]/;
	const kana = /[぀-ヿ]/;
	const counts = new Map();
	const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	let n;
	while((n = w.nextNode())){
		const el = n.parentElement;
		const v = n.nodeValue.trim();
		if(!v || !CJK.test(v) || kana.test(v)){ continue; }
		if(el.closest('svg,script,style,[data-hja-tr]') || (el.closest('[data-hja-block]'))){ continue; }
		if(!el.offsetParent && getComputedStyle(el).position !== 'fixed'){ continue; }
		counts.set(v, (counts.get(v) || 0) + 1);
	}
	return {
		installed: !!api,
		lang: api && api.lang,
		stats: api && api.stats,
		tabs,
		groups,
		title: document.title,
		remaining: Array.from(counts.entries()).sort((a, b)=>b[1] - a[1]).slice(0, 60),
	};
});

// ヘルプを開く（上部バーの「ヘルプ」）
let helpOpened = false;
let helpResidual = null;
try{
	// 先にエラーダイアログ（ダミーサーバーのため出る）を閉じる
	await page.evaluate(()=>document.querySelectorAll('.ant-modal-confirm-btns button').forEach((b)=>b.click()));
	await page.waitForTimeout(500);
	const clicked = await page.evaluate(()=>{
		const el = Array.from(document.querySelectorAll('header *, .ant-layout-header *, button, span, a'))
			.find((e)=>e.childElementCount <= 2 && e.textContent.trim() === 'ヘルプ' && e.offsetParent);
		if(!el){ return false; }
		(el.closest('button,a,[role="button"]') || el).click();
		return true;
	});
	if(!clicked){ throw new Error('ヘルプ button not found'); }
	await page.waitForTimeout(1500);
	helpOpened = true;
	await page.screenshot({ path: path.join(shotDir, 'app-help.png') });
	helpResidual = await page.evaluate(()=>{
		const modal = document.querySelector('.ant-modal-body');
		if(!modal){ return null; }
		const CJK = /[\u4e00-\u9fff]/, kana = /[\u3040-\u30ff]/;
		const left = [];
		const w = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
		let n;
		while((n = w.nextNode())){
			const el = n.parentElement;
			const v = n.nodeValue.trim();
			if(!v || !CJK.test(v) || kana.test(v)){ continue; }
			if(el.closest('[data-hja-block]') && !el.closest('[data-hja-tr]')){ continue; }
			left.push(v);
		}
		return left.slice(0, 40);
	});
}catch(e){
	errors.push('help: ' + String(e).slice(0, 120));
}

// 原文表示に切り替えて比較用スクリーンショット
await page.evaluate(()=>window.__HOROSA_I18N__.setLang('zh'));
await page.waitForTimeout(10000);
await page.screenshot({ path: path.join(shotDir, 'app-zh.png') });
const zhTabs = await page.$$eval('.horosa-main-tab-text', (els)=>els.map((e)=>e.textContent));

await browser.close();
server.close();

console.log(JSON.stringify({ loadMs, helpOpened, helpResidual, ...info, zhTabs, errors: errors.slice(0, 30) }, null, 2));
console.log(`スクリーンショット: ${shotDir}`);
