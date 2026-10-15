// 訳文に簡体字（日本語では使わない字形）が混ざっていないかを検査する。
//   node i18n-ja/tools/check-ja.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 日本語の常用漢字と字形が異なる簡体字（主なもの）。冲は四柱推命などの用語としてそのまま使うので除外。
const SIMPLIFIED = '阳们这说时间录宫盘设显导择应该还开关问题对经项单页栏选运动转换变计认让进过现发无为东车书长门见头马鸟鱼龙习乐业亲产从传伤众侧储儿兴养军农决况净几击则刚创删别剧办务劳势华协卫历压县听启员响圆团园围图坏块坚场处备复夹夺妇宁实审宽对寻层岁岛币师带帮并广库庙废异张弯弹归彻态怀恶悬惊惯愿战扩扬护报拥挂挤挥损掷摆摇敌显暂术杀杂权极构枪标树样桥检档梦欢毕气汇汉沟泽洁测济浓涂润渐满灭灵灾热爱牵猎环电疗盖监码确础离种积稳穷竞笔签简类紧红约级纪纯纳纵线练组细织终结绕绘给络绝统继维综绿缓编缘缺网罗职联胜脑节苍范荐药荣获营蓝虑补观规视览觉订讨训议记讲许论访证评识诉词译试诗诚话询详语误请诸读课谁调谈谋谓谢谱负贡财责败货质购贯贵费资赛赶趋车轨轮软轻载较辅辈辑输边达迁远违连迟适递遗释针钟钱铁银链销锁错键闭闲闻阁阅队阴际陆险隐难顶顺须顾预领频颜额风飞验齐';
let bad = 0;
function check(where, s){
	s = s.replace(/\/\S+/g, ''); // 「/合盘」のようなアプリのコマンド名は原文のまま
	const m = s.match(new RegExp('[' + SIMPLIFIED + ']', 'g'));
	if(m){
		bad++;
		console.log(`${where}: [${[...new Set(m)].join('')}] ${s.slice(0, 60)}`);
	}
}
for(const f of fs.readdirSync(path.join(root, 'dict', 'help'))){
	const d = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'help', f), 'utf8'));
	d.blocks.forEach((b, i)=>b.ja && check(`help/${f}#${i}`, b.ja.replace(/⟦\d+\|/g, '')));
	Object.entries(d.tabs || {}).forEach(([k, v])=>v && check(`help/${f}#tab ${k}`, v));
}
for(const f of fs.readdirSync(path.join(root, 'dict', 'ui'))){
	const d = JSON.parse(fs.readFileSync(path.join(root, 'dict', 'ui', f), 'utf8'));
	for(const [sec, map] of Object.entries(d)){
		if(sec.startsWith('_')){ continue; }
		for(const [zh, ja] of Object.entries(map)){ check(`ui/${f}#${zh}`, ja); }
	}
}
console.log(bad ? `${bad} 件に簡体字の疑い` : '簡体字の混入なし');
process.exit(bad ? 1 : 0);
