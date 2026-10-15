#!/bin/bash
# Horosa（星阙）日本語表示パッチ — アンインストール（元の中国語表示に戻す）
#
# 使い方: アプリを終了（⌘Q）してから、ターミナルで  bash uninstall_ja_patch.command

set -u
MARK='data-horosa-ja="1"'
if [ $# -gt 0 ]; then
	TARGETS=("$@")
else
	TARGETS=(
		"/Users/Shared/Horosa/runtime/current"
		"$HOME/Library/Application Support/com.horacedong.horosa/runtime/current"
	)
fi

echo "=== Horosa 日本語表示パッチ — アンインストール ==="
removed=0
for RT in "${TARGETS[@]}"; do
	DIST="$RT/Horosa-Web/astrostudyui/dist-file"
	INDEX="$DIST/index.html"
	[ -f "$INDEX" ] || continue
	if ! grep -q "$MARK" "$INDEX" && [ ! -d "$DIST/horosa-i18n" ]; then
		continue
	fi
	echo ""
	echo "対象: $DIST"
	if [ ! -w "$DIST" ] || [ ! -w "$INDEX" ]; then
		echo "  × 書き込み権限がありません。ターミナルで次を実行してください:"
		echo "    sudo bash \"$(cd "$(dirname "$0")" && pwd)/uninstall_ja_patch.command\""
		continue
	fi
	# 追加した 1 行だけを取り除く（アプリ側の変更が入っていても壊さない）
	perl -ni -e 'print unless /data-horosa-ja="1"/' "$INDEX"
	rm -rf "$DIST/horosa-i18n"
	rm -f "$INDEX.before-horosa-ja"
	# 圧縮版 index.html.gz も元の内容に合わせる
	if [ -f "$INDEX.gz.before-horosa-ja" ]; then
		mv -f "$INDEX.gz.before-horosa-ja" "$INDEX.gz"
	elif [ -f "$INDEX.gz" ]; then
		gzip -9 -c "$INDEX" > "$INDEX.gz.tmp" 2>/dev/null && mv -f "$INDEX.gz.tmp" "$INDEX.gz" || rm -f "$INDEX.gz.tmp" "$INDEX.gz"
	fi
	if grep -q "$MARK" "$INDEX"; then
		echo "  × 読み込みタグを取り除けませんでした"
	else
		echo "  ✓ 元に戻しました"
		removed=$((removed + 1))
	fi
done

echo ""
if [ "$removed" -eq 0 ]; then
	echo "パッチは見つかりませんでした（すでに元の状態です）。"
else
	echo "完了しました（$removed か所）。Horosa（星阙）を再起動すると中国語表示に戻ります。"
fi
