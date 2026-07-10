# ドレミバー v019

## 不具合原因

v018には、Viteでビルドする前のファイルと、ビルド後の公開用ファイルが同梱されていました。

公開環境でビルド前の `index.html` がそのまま配信されると、ブラウザが次の記述を直接読み込みます。

```js
import { BasicPitch } from "@spotify/basic-pitch";
```

ブラウザはこのパッケージ名を直接解決できないため、JavaScript全体が初期化前に停止していました。

その結果、次の機能がまとめて動かない状態になっていました。

- 音声ファイル選択後の読込
- 録音開始・録音停止
- 解析
- JavaScriptを使う保存機能

## v019の修正

公開用ルートには、Viteでビルド済みの静的ファイルだけを配置しています。

```text
doremi_bar_v019/
├─ index.html
├─ assets/
│  ├─ index-....js
│  └─ index-....css
├─ model/
│  ├─ model.json
│  └─ group1-shard1of1.bin
├─ vercel.json
├─ README.md
└─ source/
   ├─ index.html
   ├─ app.js
   ├─ styles.css
   ├─ package.json
   └─ public/model/
```

`source`フォルダは今後の編集用です。
公開されるアプリは、ルートにあるビルド済みファイルを使用します。

## Vercel設定

今回はVercel側でビルドを行いません。

- Framework Preset：Other
- Build Command：空欄
- Output Directory：空欄
- Install Command：空欄

既存プロジェクトでVite設定が残っている場合は、Framework PresetをOtherへ変更してください。

## 動作確認

1. 音声ファイル選択欄を押す
2. MP3・WAV・M4Aなどを選ぶ
3. 音声プレイヤーへ反映されることを確認
4. 録音開始を押す
5. マイク許可を承認
6. 録音停止後に音声プレイヤーへ反映されることを確認
7. Basic Pitchまたは通常解析を実行

録音はHTTPSまたはlocalhostで利用してください。
