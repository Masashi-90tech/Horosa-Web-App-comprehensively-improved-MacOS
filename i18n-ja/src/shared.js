// 抽出ツール（Node）と実行時エンジン（ブラウザ）で共有する判定規則。
// ここを変えると辞書のキーが一致しなくなるので、変えたら全辞書を再抽出すること。

var CJK_RE = /[㐀-鿿豈-﫿]/;

// 辞書キー用の正規化: 空白（全角空白含む）をすべて除去する。
// antd がボタン文字に挟む空白（「确 定」）や JSX の改行差を吸収するため。
function normalize(s){
	return String(s == null ? '' : s).replace(/[\s　]+/g, '');
}

function hasCjk(s){
	return CJK_RE.test(s);
}

// 翻訳ブロックの候補: 直下に中国語を含むテキストノードを持つ要素。
// （子孫ではなく「直下」なので、段落 <p>本页排<b>本命盘</b>…</p> は p が 1 ブロックになる）
function isBlockCandidate(el, NodeCtor){
	var TEXT = NodeCtor ? NodeCtor.TEXT_NODE : 3;
	for(var ch = el.firstChild; ch; ch = ch.nextSibling){
		if(ch.nodeType === TEXT && CJK_RE.test(ch.nodeValue)){
			return true;
		}
	}
	return false;
}

module.exports = { normalize: normalize, hasCjk: hasCjk, isBlockCandidate: isBlockCandidate, CJK_RE: CJK_RE };
