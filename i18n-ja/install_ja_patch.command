#!/bin/bash
# Horosa（星阙）日本語表示パッチ — インストール
#
# インストール済みのアプリの「画面ファイル」に、翻訳スクリプトを 1 行追加するだけです。
# 計算エンジン（Python / Java）・アプリ本体・保存データには一切触れません。
# 元に戻すときは uninstall_ja_patch.command を実行してください。
#
# 使い方: アプリを終了（⌘Q）してから、このファイルをダブルクリック
#         （開けない場合はターミナルで  bash install_ja_patch.command ）
# 引数を付けると、そのランタイム（…/runtime/current）だけを対象にします（テスト用）。

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/patch/horosa-i18n"
MARK='data-horosa-ja="1"'
TAG='<script src="./horosa-i18n/horosa-ja.js" data-horosa-ja="1"></script>'

if [ $# -gt 0 ]; then
	TARGETS=("$@")
else
	TARGETS=(
		"/Users/Shared/Horosa/runtime/current"
		"$HOME/Library/Application Support/com.horacedong.horosa/runtime/current"
	)
fi

echo "=== Horosa 日本語表示パッチ v$(cat "$SRC/VERSION" 2>/dev/null) — インストール ==="
if [ ! -f "$SRC/horosa-ja.js" ]; then
	echo "エラー: $SRC/horosa-ja.js が見つかりません。フォルダごと展開してから実行してください。"
	exit 1
fi
if ! command -v perl >/dev/null 2>&1; then
	echo "エラー: perl が見つかりません（macOS には標準で入っています）。"
	exit 1
fi

installed=0
for RT in "${TARGETS[@]}"; do
	DIST="$RT/Horosa-Web/astrostudyui/dist-file"
	INDEX="$DIST/index.html"
	[ -f "$INDEX" ] || continue
	echo ""
	echo "対象: $DIST"
	if [ ! -w "$DIST" ] || [ ! -w "$INDEX" ]; then
		echo "  × 書き込み権限がありません。ターミナルで次を実行してください:"
		echo "    sudo bash \"$HERE/install_ja_patch.command\""
		continue
	fi
	# 1) 翻訳スクリプトを配置（上書き更新）
	rm -rf "$DIST/horosa-i18n"
	cp -R "$SRC" "$DIST/horosa-i18n" || { echo "  × コピーに失敗しました"; continue; }
	# 2) index.html の </head> の直前に 1 行追加（追加済みなら何もしない）
	if grep -q "$MARK" "$INDEX"; then
		echo "  ✓ 読み込みタグは追加済み（スクリプトだけ更新しました）"
	else
		cp -p "$INDEX" "$INDEX.before-horosa-ja"
		HJA_TAG="$TAG" perl -0pi -e 's#</head>#$ENV{HJA_TAG}\n</head>#i' "$INDEX"
		if grep -q "$MARK" "$INDEX"; then
			echo "  ✓ index.html に読み込みタグを追加しました（元のファイル: index.html.before-horosa-ja）"
		else
			cp -p "$INDEX.before-horosa-ja" "$INDEX"
			echo "  × index.html に </head> が見つからず、追加できませんでした（変更は元に戻しました）"
			continue
		fi
	fi
	installed=$((installed + 1))
done

echo ""
if [ "$installed" -eq 0 ]; then
	echo "インストール先が見つかりませんでした。"
	echo "Horosa（星阙）を一度起動して初期セットアップを済ませてから、もう一度実行してください。"
	exit 1
fi
echo "完了しました（$installed か所）。Horosa（星阙）を起動すると日本語で表示されます。"
echo "・画面左下の「中文」ボタンで原文（中国語）表示に切り替えられます。"
echo "・アプリをアップデートするとパッチが外れます。そのときはこのファイルをもう一度実行してください。"
