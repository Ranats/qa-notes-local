# Q&A Notes ローカル版

英語の質問を聞きながら、発表者が手元で想定問答と資料を参照するWindows向けツールです。最初に、HAI 2026で実際に使用した発表・想定問答で操作を試せます。

## GitHubから取得して起動する

Windows、Git、Node.js 22以降を用意します。GitHubでこのリポジトリの **Code → HTTPS** からURLをコピーし、PowerShellで次を実行してください。

```powershell
$repoUrl = Get-Clipboard
git clone $repoUrl qa-notes-local
cd qa-notes-local
Copy-Item .env.example .env.local
```

`.env.local` を開き、自分の `OPENAI_API_KEY` を設定します。音声入力・回答生成を使う場合は `budget-config.json` を `budget-config.local.json` にコピーし、利用上限と期限を設定します。起動するには `Start_QA_Notes.cmd` をダブルクリックします。ターミナルに出る `http://127.0.0.1:8765/` をChromeまたはEdgeで開いてください。定型文を探すだけならAPIキーも予算設定も必要ありません。

`.env.local`、`budget-config.local.json`、画面から取り込んだ資料、利用額の記録はGitに追加されない設定です。APIキーはこのPCのサーバーが読み込みます。キーや個人の資料をGitHubに送らないでください。

## 1　無料で試す

クローンしたフォルダーの `QA_Notes.html` を開き、質問欄に `Q13` と入力してください。「変化が小さければ良いのか」について、英語の返答と日本語訳が表示されます。定型文の検索と表示はPCの中で完結します。

## 2　自分の発表に合わせる

Node.js 22以降を用意し、`Start_QA_Notes.cmd` で開いて「自分の資料で試す」を選びます。PDF・PPTX・DOCX・テキスト・Markdown・HTML・CSV・Notebook・コード、またはZIPを指定できます。フォルダーやローカルにクローンしたリポジトリ、公開GitHubリポジトリのURLも選べます。公開GitHubの一覧はブラウザーがGitHub APIから取得し、使用するファイルを選んだ後に固定コミット内の内容を読みます。非公開リポジトリは手元のクローンかZIPを使用します。

画面で発表名、質問と英語回答、必要なら日本語訳・検索語・確認フレーズを入力します。想定問答は1件ずつ追加、タブ区切りで貼付、または既存の`qa`配列を持つJSONから読み込みできます。原稿も資料ファイルとして選べます。登録結果はこのPCの`user-presentation.json`に保存されます。画面でHAI論文と自分の資料を切り替え、「登録した資料を削除」で消去できます。単独で`QA_Notes.html`を開いた場合も定型文は使えます。PDFなどの資料取り込みと回答生成には起動ファイルを使ってください。

一度に選ぶファイルは30件、合計24 MB、本文は約7万字まで。ZIPは10 MBまで。隠しフォルダー、認証情報に見えるファイル、依存パッケージやビルド出力は対象外です。画像として保存されたPDF・スライドの文字は抽出できないため、OCR済みの資料を使用してください。取り込んだ文書は、回答を要求するときに関連する抜粋をAPIへ送ります。手元の設定で`presentation.json`を直接編集する従来の方法も使えます。同じフォルダーで`node presentation.cjs`を実行するとオフラインHTMLを更新できます。

## 3　音声入力・回答生成を有効にする

1. OpenAI APIを利用できるご自身のキーを用意します。`.env.example` を同じ場所へ `.env.local` という名前でコピーし、テキストエディターで `OPENAI_API_KEY=` の右に入力して保存します。
2. `budget-config.json` を `budget-config.local.json` にコピーし、`limitUSD` に、このフォルダーで許容する累計利用額（USD）を指定します。予算とAPIの利用可否を確認したら `creditVerified` を `true` にし、`creditExpiresAt` に自分で決めた終了日時をタイムゾーン付きISO形式で入力します（形式例 `2027-01-01T00:00:00+09:00`）。初期状態では音声・回答の送信は停止しています。金額表示はローカル推計です。請求額や残高はOpenAI側で確認してください。
3. `Start_QA_Notes.cmd` をダブルクリックし、ターミナルが表示したローカルURLをEdgeまたはChromeで開きます。終了はターミナルで Ctrl+C。追加のnpmインストールは不要です。
4. 会場のルールと質問者の了解を確認し、「録音開始」を押します。録音中は音声がOpenAIへ届きます。「停止して質問欄へ反映」後に聞き取りを修正できます。回答ボタンを押すと質問・登録資料・想定問答をOpenAIへ送り、英語の回答案と日本語訳を表示します。自動判定は任意です。定型文が意図とずれた場合は「質問を修正」、または「定型文を使わず資料から回答」を使います。生成結果と根拠を確認してから発言してください。

録音は1回5分まで。アプリはマイク音声やライブの質問・回答をディスク保存しません。回答キャッシュはサーバー終了までメモリに残り、費用・利用時間はローカル台帳に記録します。通信断や上限到達時には手入力と定型文を使えます。API側でのデータの取り扱いと現行料金は公式資料をご覧ください。[データの取り扱い](https://developers.openai.com/api/docs/guides/your-data) ／ [料金](https://openai.com/api/pricing/)

同梱のWebSocketライブラリのライセンスは [ws LICENSE](vendor/ws/LICENSE) にあります。
PDFとOffice文書の取り込みには [PDF.js LICENSE](importer-vendor/pdfjs/LICENSE) と [JSZip LICENSE](importer-vendor/jszip/LICENSE.markdown) を同梱しています。

## 同梱資料

Satoshi Koda, Hiroshi Someya, Kagayaki Kuroda (2026), *Persona-Isolated Evaluation of LLM-Based Dialogue Agents: Measuring History-Conditioned Response Variation*, HAI ’26。© 2026 著者。論文本文を抽出し、ページ別の抜粋に整形しています。発表者が使用したスライド原稿・24件の想定問答・8件の聞き返しフレーズも収録しています。[論文](https://doi.org/10.1145/3841580.3841608) ／ [論文のライセンス CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
