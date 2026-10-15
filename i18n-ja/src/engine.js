// Horosa 日本語表示パッチ · 実行時エンジン
//
// 方針（最重要）:
//   - アプリ本体の JS・計算ロジック・データ・API 通信には一切触れない。
//   - React が画面に描いた「文字」だけを、表示の直前（MutationObserver = 描画前のマイクロタスク）に差し替える。
//   - 辞書に無い文字列は中国語のまま表示する（翻訳漏れがあっても壊れない）。
//   - 星盤などの SVG / Canvas、入力欄、エディタの中身は対象外。
//
// 差し替えの 2 方式:
//   1) テキストノード: nodeValue を辞書の訳に置き換える（React はノードを再利用するので安全）。
//   2) ブロック（解説の段落など、太字などが混在する要素）: React の子ノードは一切動かさず、
//      CSS で原文を隠し、訳文の <span data-hja-tr> を末尾に足す。原文が変われば自動で張り直す。

var shared = require('./shared');
var DATA = require('../build/data.json');

(function(){
	'use strict';
	if(typeof window === 'undefined' || window.__HOROSA_I18N__){
		return;
	}

	var normalize = shared.normalize;
	var CJK_RE = shared.CJK_RE;
	var STORAGE_KEY = 'horosa.i18n.lang';
	var TEXT = DATA.text;
	var BLOCKS = DATA.blocks;
	var SCOPED = DATA.scoped;
	var PATTERNS = DATA.patterns.map(function(p){ return [new RegExp(p[0]), p[1]]; });
	var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
	var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1, CANVAS: 1, IFRAME: 1, svg: 1, SVG: 1, math: 1 };
	var SKIP_SEL = '[contenteditable=""],[contenteditable="true"],.monaco-editor,.ql-editor,[data-hja-skip],[data-hja-tr],svg';
	var INTERACTIVE_SEL = 'input,textarea,select,button';

	function readLang(){
		try{
			var v = window.localStorage.getItem(STORAGE_KEY);
			if(v === 'ja' || v === 'zh'){
				return v;
			}
		}catch(e){ /* ストレージ不可でも既定（日本語）で動く */ }
		return 'ja';
	}

	var lang = readLang();
	var stats = { text: 0, block: 0, attr: 0 };
	var debug = false;
	var missing = new Map();

	var api = window.__HOROSA_I18N__ = {
		version: DATA.version,
		lang: lang,
		stats: stats,
		setLang: function(next){
			try{ window.localStorage.setItem(STORAGE_KEY, next); }catch(e){ /* 無視 */ }
			window.location.reload();
		},
		// 開発用: 未翻訳の文字列を集める。__HOROSA_I18N__.debugMissing() → 操作 → __HOROSA_I18N__.dumpMissing()
		debugMissing: function(){ debug = true; missing.clear(); },
		dumpMissing: function(){
			return Array.from(missing.entries()).sort(function(a, b){ return b[1] - a[1]; }).map(function(e){ return e[0]; }).join('\n');
		},
	};

	// ── 言語切替ボタン ─────────────────────────────────────────────
	function mountSwitcher(){
		if(!document.body || document.getElementById('hja-switch')){
			return;
		}
		var btn = document.createElement('button');
		btn.id = 'hja-switch';
		btn.type = 'button';
		btn.setAttribute('data-hja-skip', '1');
		btn.textContent = lang === 'ja' ? '中文' : '日本語';
		btn.title = lang === 'ja'
			? '中国語（原文）表示に切り替えます（画面を再読み込みします）'
			: '切换为日语显示（将重新加载页面）';
		btn.addEventListener('click', function(){
			api.setLang(lang === 'ja' ? 'zh' : 'ja');
		});
		document.body.appendChild(btn);
	}

	function injectStyle(){
		var css = ''
			+ '#hja-switch{position:fixed;left:6px;bottom:6px;z-index:2147483000;font:11px/1.6 -apple-system,"Hiragino Sans",sans-serif;'
			+ 'padding:0 7px;border-radius:9px;border:1px solid rgba(128,128,128,.45);background:rgba(128,128,128,.12);color:inherit;opacity:.45;cursor:pointer}'
			+ '#hja-switch:hover{opacity:1}'
			+ '[data-hja-block]{font-size:0!important}'
			+ '[data-hja-block]>:not([data-hja-tr]){display:none!important}';
		var style = document.createElement('style');
		style.id = 'hja-style';
		style.textContent = css;
		(document.head || document.documentElement).appendChild(style);
	}

	function onReady(fn){
		if(document.readyState === 'loading'){
			document.addEventListener('DOMContentLoaded', fn);
		}else{
			fn();
		}
	}

	if(lang !== 'ja'){
		onReady(function(){ injectStyle(); mountSwitcher(); });
		return;
	}

	// ── 辞書引き ─────────────────────────────────────────────────
	function scopedLookup(key, el){
		for(var i = 0; i < SCOPED.length; i++){
			var s = SCOPED[i];
			if(Object.prototype.hasOwnProperty.call(s.map, key) && el && el.closest && el.closest(s.selector)){
				return s.map[key];
			}
		}
		return null;
	}

	function lookup(raw, el){
		var key = normalize(raw);
		if(!key){
			return null;
		}
		var hit = scopedLookup(key, el);
		if(hit != null){
			return hit;
		}
		if(Object.prototype.hasOwnProperty.call(TEXT, key)){
			return TEXT[key];
		}
		for(var i = 0; i < PATTERNS.length; i++){
			if(PATTERNS[i][0].test(key)){
				return key.replace(PATTERNS[i][0], PATTERNS[i][1]);
			}
		}
		if(debug){
			missing.set(raw.trim(), (missing.get(raw.trim()) || 0) + 1);
		}
		return null;
	}

	// 自分で書いた値は再翻訳しない（訳文が別の原文キーと偶然一致する事故を防ぐ）。
	var lastText = new WeakMap();
	var lastAttr = new WeakMap();

	function translateTextNode(node){
		var v = node.nodeValue;
		if(!v || !CJK_RE.test(v) || lastText.get(node) === v){
			return;
		}
		var ja = lookup(v, node.parentElement);
		if(ja == null){
			return;
		}
		var lead = v.match(/^\s*/)[0];
		var trail = v.match(/\s*$/)[0];
		var next = lead + ja + trail;
		lastText.set(node, next);
		if(next !== v){
			node.nodeValue = next;
			stats.text++;
		}
	}

	function translateAttrs(el){
		if(!el.hasAttribute){
			return;
		}
		for(var i = 0; i < ATTRS.length; i++){
			var name = ATTRS[i];
			var v = el.getAttribute(name);
			if(!v || !CJK_RE.test(v)){
				continue;
			}
			var seen = lastAttr.get(el);
			if(seen && seen[name] === v){
				continue;
			}
			var ja = lookup(v, el);
			if(ja == null){
				continue;
			}
			if(!seen){
				seen = {};
				lastAttr.set(el, seen);
			}
			seen[name] = ja;
			if(ja !== v){
				el.setAttribute(name, ja);
				stats.attr++;
			}
		}
	}

	// ── ブロック（段落単位）──────────────────────────────────────
	function ownText(el){
		// 自分が足した訳文 span を除いた textContent。
		var s = '';
		for(var ch = el.firstChild; ch; ch = ch.nextSibling){
			if(ch.nodeType === 1 && ch.hasAttribute('data-hja-tr')){
				continue;
			}
			s += ch.textContent;
		}
		return s;
	}

	function blockTemplate(el){
		var key = normalize(ownText(el));
		if(key.length < DATA.blockMinLen || key.length > DATA.blockMaxLen){
			return null;
		}
		return Object.prototype.hasOwnProperty.call(BLOCKS, key) ? BLOCKS[key] : null;
	}

	function isPlainTemplate(tpl){
		return tpl.length === 1 && typeof tpl[0] === 'string';
	}

	function singleTextChild(el){
		var only = el.firstChild;
		return only && !only.nextSibling && only.nodeType === 3 ? only : null;
	}

	function clearOverlay(el){
		for(var ch = el.firstChild; ch;){
			var next = ch.nextSibling;
			if(ch.nodeType === 1 && ch.hasAttribute('data-hja-tr')){
				el.removeChild(ch);
			}
			ch = next;
		}
		el.removeAttribute('data-hja-block');
	}

	function elementChildren(el){
		var out = [];
		for(var ch = el.firstChild; ch; ch = ch.nextSibling){
			if(ch.nodeType === 1 && !ch.hasAttribute('data-hja-tr')){
				out.push(ch);
			}
		}
		return out;
	}

	function buildOverlay(el, tpl, fontSize){
		var originals = elementChildren(el);
		var span = document.createElement('span');
		span.setAttribute('data-hja-tr', '1');
		span.style.fontSize = fontSize;
		for(var i = 0; i < tpl.length; i++){
			var seg = tpl[i];
			if(typeof seg === 'string'){
				span.appendChild(document.createTextNode(seg));
				continue;
			}
			var orig = originals[seg[0]];
			var tag = orig && /^(B|STRONG|I|EM|SPAN|SMALL|SUP|SUB|U|MARK|KBD)$/.test(orig.tagName) ? orig.tagName : 'SPAN';
			var clone = document.createElement(tag);
			if(orig){
				if(orig.getAttribute('style')){ clone.setAttribute('style', orig.getAttribute('style')); }
				if(orig.getAttribute('class')){ clone.setAttribute('class', orig.getAttribute('class')); }
			}
			clone.textContent = seg[1];
			span.appendChild(clone);
		}
		el.appendChild(span);
		el.setAttribute('data-hja-block', '1');
		stats.block++;
	}

	// 適用待ちのブロック。getComputedStyle を「全部読んでから全部書く」ためにまとめて処理する。
	var pendingBlocks = [];

	function considerBlock(el){
		var tpl = blockTemplate(el);
		if(!tpl){
			return false;
		}
		if(el.querySelector(INTERACTIVE_SEL)){
			return false;
		}
		var only = singleTextChild(el);
		if(only && isPlainTemplate(tpl)){
			// 単純な 1 テキストの要素は、テキストノードを直接置き換える。
			var v = only.nodeValue;
			var next = v.match(/^\s*/)[0] + tpl[0] + v.match(/\s*$/)[0];
			lastText.set(only, next);
			if(next !== v){
				only.nodeValue = next;
				stats.text++;
			}
			return true;
		}
		pendingBlocks.push([el, tpl]);
		return true;
	}

	function flushBlocks(){
		if(!pendingBlocks.length){
			return;
		}
		var jobs = pendingBlocks;
		pendingBlocks = [];
		var sizes = [];
		for(var i = 0; i < jobs.length; i++){
			var el = jobs[i][0];
			if(el.hasAttribute('data-hja-block')){
				clearOverlay(el);
			}
			sizes.push(window.getComputedStyle(el).fontSize);
		}
		for(var j = 0; j < jobs.length; j++){
			buildOverlay(jobs[j][0], jobs[j][1], sizes[j]);
		}
	}

	// ── 走査 ─────────────────────────────────────────────────────
	function isSkippedElement(el){
		return !!SKIP_TAGS[el.tagName] || (el.matches && el.matches(SKIP_SEL));
	}

	function insideSkipped(node){
		var el = node.nodeType === 1 ? node : node.parentElement;
		return !el || !!(el.closest && el.closest(SKIP_SEL)) || (el.tagName && !!SKIP_TAGS[el.tagName]);
	}

	function scan(root){
		if(root.nodeType === 3){
			if(!insideSkipped(root)){
				translateTextNode(root);
			}
			return;
		}
		if(root.nodeType !== 1 || insideSkipped(root)){
			return;
		}
		var stack = [root];
		while(stack.length){
			var el = stack.pop();
			if(isSkippedElement(el)){
				// 入力欄そのものの値は訳さないが、placeholder / title は表示文言なので訳す。
				if((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.closest('[data-hja-skip]')){
					translateAttrs(el);
				}
				continue;
			}
			translateAttrs(el);
			if(shared.isBlockCandidate(el) && considerBlock(el)){
				continue;
			}
			for(var ch = el.lastChild; ch; ch = ch.previousSibling){
				if(ch.nodeType === 3){
					translateTextNode(ch);
				}else if(ch.nodeType === 1){
					stack.push(ch);
				}
			}
		}
	}

	function ownerBlock(node){
		var el = node.nodeType === 1 ? node : node.parentElement;
		return el && el.closest ? el.closest('[data-hja-block]') : null;
	}

	function inOverlay(node){
		var el = node.nodeType === 1 ? node : node.parentElement;
		return !!(el && el.closest && el.closest('[data-hja-tr]'));
	}

	function rescanBlock(block){
		clearOverlay(block);
		scan(block);
	}

	function isOwnNode(n){
		return n.nodeType === 1 && n.hasAttribute('data-hja-tr');
	}

	// 訳文 span の追加・削除だけの変更（＝自分の操作）か。
	function onlyOwnNodes(m){
		var i;
		for(i = 0; i < m.addedNodes.length; i++){
			if(!isOwnNode(m.addedNodes[i])){ return false; }
		}
		for(i = 0; i < m.removedNodes.length; i++){
			if(!isOwnNode(m.removedNodes[i])){ return false; }
		}
		return true;
	}

	function handle(mutations){
		var blocks = new Set();
		for(var i = 0; i < mutations.length; i++){
			var m = mutations[i];
			if(inOverlay(m.target) || (m.type === 'childList' && onlyOwnNodes(m))){
				continue;
			}
			var block = ownerBlock(m.target);
			if(m.type === 'attributes'){
				// data-hja-block 自体の付け外しは自分の操作。
				if(m.target.nodeType === 1 && !(m.target.closest && m.target.closest('[data-hja-skip],[contenteditable=""],[contenteditable="true"],svg'))){
					translateAttrs(m.target);
				}
				continue;
			}
			if(block){
				// React がブロック内の原文を書き換えた → 訳文を張り直す。
				blocks.add(block);
				continue;
			}
			if(m.type === 'characterData'){
				if(!insideSkipped(m.target)){
					var parent = m.target.parentElement;
					if(parent && shared.isBlockCandidate(parent) && blockTemplate(parent)){
						scan(parent);
					}else{
						translateTextNode(m.target);
					}
				}
				continue;
			}
			// childList
			var added = m.addedNodes;
			for(var k = 0; k < added.length; k++){
				var n = added[k];
				if(n.nodeType === 1 && n.hasAttribute('data-hja-tr')){
					continue;
				}
				if(n.nodeType === 3 && m.target.nodeType === 1 && shared.isBlockCandidate(m.target) && blockTemplate(m.target)){
					scan(m.target);
					continue;
				}
				scan(n);
			}
		}
		blocks.forEach(function(b){
			if(b.isConnected){
				rescanBlock(b);
			}
		});
		flushBlocks();
	}

	var observer = new MutationObserver(function(muts){
		try{
			handle(muts);
		}catch(e){
			// 翻訳の不具合でアプリを止めない。
			if(window.console){ window.console.warn('[horosa-ja]', e); }
		}
	});

	// <head> の中で読み込まれた時点で監視を始める（React の初回描画より前）。
	// こうすると、アプリが描いた中国語が一瞬でも画面に出る前に置き換わる。
	function start(){
		injectStyle();
		document.documentElement.setAttribute('lang', 'ja');
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ATTRS,
		});
		onReady(function(){
			try{
				scan(document.documentElement);
				flushBlocks();
			}catch(e){
				if(window.console){ window.console.warn('[horosa-ja]', e); }
			}
			mountSwitcher();
		});
	}

	start();
})();
