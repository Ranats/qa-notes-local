(function () {
  'use strict';
  const MAX_FILES = 30;
  const MAX_CANDIDATES = 200;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
  const MAX_CHARS = 70000;
  const MAX_SOURCES = 180;
  const allowed = new Set(['pdf', 'pptx', 'docx', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'py', 'r', 'ipynb', 'tex']);
  const blockedParts = new Set(['.git', '.github', '.venv', 'venv', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__', '.next', '.cache']);
  const secretName = /(^|[._/-])(?:\.env|secret|secrets|credential|credentials|password|token|api.?key|private.?key|id_rsa|id_ed25519)([._/-]|$)|\.(?:pem|p12|pfx|key|sqlite|db)$/i;
  const secretContent = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|DATABASE_URL)\s*=/i;
  const textTypes = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'py', 'r', 'ipynb', 'tex']);
  let pdfModule;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function extension(name) { return name.split('.').pop().toLowerCase(); }
  function safePath(name) {
    const parts = name.replaceAll('\\', '/').split('/');
    return !name.startsWith('/') && !parts.some(part => !part || part === '..' || part.startsWith('.') || blockedParts.has(part.toLowerCase())) &&
      !secretName.test(name) && allowed.has(extension(name));
  }
  function pathOf(file) { return file.webkitRelativePath || file.name; }
  async function githubJson(path) {
    const response = await fetch('https://api.github.com' + path, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit', redirect: 'error', mode: 'cors', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw Error('GitHubの公開資料を読めませんでした（HTTP ' + response.status + '）。');
    return response.json();
  }
  function trimText(s) { return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
  function scan(text, name) {
    if (secretContent.test(text)) throw Error(name + ' に認証情報らしい記述があります。対象から外してください。');
    return trimText(text);
  }
  function chunks(text, title, sources, budget) {
    let rest = text;
    let part = 1;
    while (rest && sources.length < MAX_SOURCES && budget.remaining > 0) {
      const limit = Math.min(1100, budget.remaining);
      let end = rest.length <= limit ? rest.length : Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf('。', limit) + 1, rest.lastIndexOf('. ', limit) + 1);
      if (end < Math.min(300, limit / 2)) end = limit;
      const piece = rest.slice(0, end).trim();
      if (piece) {
        sources.push({ id: 'D' + String(sources.length + 1).padStart(3, '0'), title: title + (part > 1 ? ' · ' + part : ''), text: piece });
        budget.remaining -= piece.length;
      }
      rest = rest.slice(end).trim();
      part += 1;
    }
    if (rest) throw Error('資料が長すぎます。重要な資料を絞ってください。');
  }
  async function zipLibrary(base) {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = base + 'importer-vendor/jszip/jszip.min.js';
      tag.onload = resolve;
      tag.onerror = () => reject(Error('ZIP・Office文書の読込ライブラリを開けません。'));
      document.head.append(tag);
    });
    return window.JSZip;
  }
  async function pdfLibrary(base) {
    if (!pdfModule) {
      pdfModule = await import(base + 'importer-vendor/pdfjs/pdf.min.mjs');
      pdfModule.GlobalWorkerOptions.workerSrc = base + 'importer-vendor/pdfjs/pdf.worker.min.mjs';
    }
    return pdfModule;
  }
  async function parsePdf(file, base, sources, budget, title) {
    const pdf = await pdfLibrary(base);
    const task = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
    const document = await task.promise;
    try {
      for (let number = 1; number <= document.numPages && budget.remaining > 0; number += 1) {
        const page = await document.getPage(number);
        const contents = await page.getTextContent();
        const text = scan(contents.items.map(item => item.str || '').join(' '), title + ' p.' + number);
        if (!text) throw Error(title + ' の' + number + 'ページは文字を抽出できません。画像PDFにはOCR済みの資料を使ってください。');
        chunks(text, title + ' · p. ' + number, sources, budget);
        page.cleanup();
      }
    } finally { await document.destroy(); }
  }
  function xmlText(xml, tagName) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('Office文書を解析できません。');
    return [...doc.getElementsByTagName(tagName)].map(node => node.textContent).join(' ');
  }
  async function parseOffice(file, base, sources, budget, title) {
    const zip = await (await zipLibrary(base)).loadAsync(file);
    const isSlide = extension(title) === 'pptx';
    const paths = Object.keys(zip.files).filter(name => isSlide
      ? /^ppt\/slides\/slide\d+\.xml$/.test(name)
      : name === 'word/document.xml').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!paths.length) throw Error(title + ' に読めるテキストがありません。');
    for (const [index, name] of paths.entries()) {
      const entry = zip.files[name];
      if (entry._data?.uncompressedSize > MAX_FILE_BYTES) throw Error(title + ' の展開サイズが大きすぎます。');
      const xml = await entry.async('string');
      const label = title + (isSlide ? ' · slide ' + (index + 1) : '');
      const text = scan(xmlText(xml, isSlide ? 'a:t' : 'w:t'), label);
      if (!text) throw Error(label + ' に文字を抽出できません。画像中の文字にはOCRが必要です。');
      chunks(text, label, sources, budget);
      if (budget.remaining <= 0) break;
    }
  }
  async function parseText(file, sources, budget, title) {
    let text = await file.text();
    if (extension(title) === 'html' || extension(title) === 'htm') {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      doc.querySelectorAll('script,style,template,noscript').forEach(node => node.remove());
      text = doc.body.textContent || '';
    }
    if (extension(title) === 'ipynb') {
      try {
        const notebook = JSON.parse(text);
        text = (notebook.cells || []).map(cell => (cell.source || []).join('')).join('\n\n');
      } catch { throw Error(title + ' はNotebookのJSONとして読めません。'); }
    }
    chunks(scan(text, title), title, sources, budget);
  }
  async function unpackZip(file, base) {
    if (file.size > MAX_FILE_BYTES) throw Error('ZIPは10 MBまでです。');
    const zip = await (await zipLibrary(base)).loadAsync(file);
    const result = [];
    let total = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !safePath(name)) continue;
      const size = entry._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) continue;
      total += size;
      if (total > 80 * 1024 * 1024 || result.length >= MAX_CANDIDATES) throw Error('ZIP内の対象候補が上限を超えました。必要なファイルを個別に選んでください。');
      result.push({ name: name.split('/').pop(), webkitRelativePath: name, size,
        arrayBuffer: async () => (await entry.async('uint8array')).buffer,
        text: () => entry.async('string') });
    }
    return result;
  }
  function parseRows(raw, type) {
    const rows = raw.trim() ? raw.trim().split(/\r?\n/) : [];
    const max = type === 'qa' ? 64 : 24;
    if (rows.length > max) throw Error((type === 'qa' ? '想定問答' : '聞き返し') + 'は' + max + '件までです。');
    return rows.map((line, index) => {
      const cells = line.split('\t').map(cell => cell.trim());
      if (type === 'qa') {
        if (cells.length < 2 || !cells[0] || !cells[1]) throw Error('想定問答の' + (index + 1) + '行目は「質問<Tab>英語回答」が必要です。');
        if (cells[0].length > 1000 || cells[1].length > 3000 || (cells[2] || '').length > 3000 || (cells[3] || '').length > 1000 || (cells[4] || '').length > 1000)
          throw Error('想定問答の' + (index + 1) + '行目が長すぎます。');
        const id = 'Q' + String(index + 1).padStart(2, '0');
        return { id, title: cells[0].slice(0, 100), question: cells[0], cues: cells[3] || cells[0],
          answer: cells[1], ja: cells[2] || '日本語訳は未登録です。', source: '登録した想定問答',
          ...(cells[4] ? { confirm: cells[4] } : {}) };
      }
      if (!cells[0]) throw Error('聞き返しの' + (index + 1) + '行目に英語のフレーズを入力してください。');
      if (cells[0].length > 3000 || (cells[1] || '').length > 3000) throw Error('聞き返しの' + (index + 1) + '行目が長すぎます。');
      return { title: cells[0].slice(0, 100), answer: cells[0], ja: cells[1] || '日本語訳は未登録です。' };
    });
  }
  function mount(container, onReady, options = {}) {
    const base = options.assetBase || '/';
    const root = element('section', undefined, 'importer card');
    const heading = element('h2', '自分の資料で試す');
    const description = element('p', 'ファイル、フォルダー、クローン済みリポジトリを選び、使う資料を確認してください。質問と資料は回答を求めるまでAIへ送られません。', 'muted');
    const fileLabel = element('label', '資料ファイル ');
    const fileInput = element('input'); fileInput.type = 'file'; fileInput.multiple = true;
    fileInput.accept = [...allowed].map(ext => '.' + ext).join(',') + ',.zip';
    fileLabel.append(fileInput);
    const folderLabel = element('label', 'フォルダー / リポジトリ ');
    const folderInput = element('input'); folderInput.type = 'file'; folderInput.multiple = true;
    folderInput.setAttribute('webkitdirectory', '');
    folderLabel.append(folderInput);
    const githubLabel = element('label', '公開GitHubリポジトリのURL ');
    const githubInput = element('input'); githubInput.type = 'url'; githubInput.placeholder = 'https://github.com/owner/repository';
    const githubButton = element('button', 'ファイル一覧を取得');
    githubLabel.append(githubInput, githubButton);
    const selected = element('div', '', 'importer-files');
    const titleLabel = element('label', '発表・資料の名前 ');
    const titleInput = element('input'); titleInput.type = 'text'; titleInput.maxLength = 240; titleInput.placeholder = '例：研究発表2026';
    titleLabel.append(titleInput);
    const qaLabel = element('label', '想定問答（各行「質問<Tab>英語回答<Tab>日本語訳<Tab>検索語<Tab>確認フレーズ」）');
    const qaInput = element('textarea'); qaInput.rows = 4; qaInput.placeholder = 'What is the main result?\tOur main finding is…\t主な結果は…\tmain result';
    qaLabel.append(qaInput);
    const qaFields = element('div', undefined, 'importer-qa-fields');
    const questionField = element('input'); questionField.placeholder = '想定質問';
    const answerField = element('input'); answerField.placeholder = '英語の回答';
    const japaneseField = element('input'); japaneseField.placeholder = '日本語訳（任意）';
    const cueField = element('input'); cueField.placeholder = '検索語（任意）';
    const confirmField = element('input'); confirmField.placeholder = '確認フレーズ（任意）';
    const addQuestion = element('button', '想定問答を1件追加');
    qaFields.append(questionField, answerField, japaneseField, cueField, confirmField, addQuestion);
    addQuestion.onclick = () => {
      if (!questionField.value.trim() || !answerField.value.trim()) { status.textContent = '質問と英語の回答を入力してください。'; return; }
      const row = [questionField, answerField, japaneseField, cueField, confirmField].map(input => input.value.replace(/[\t\r\n]/g, ' ').trim()).join('\t');
      qaInput.value += (qaInput.value.trim() ? '\n' : '') + row;
      for (const input of [questionField, answerField, japaneseField, cueField, confirmField]) input.value = '';
      status.textContent = '想定問答を追加しました。上の一覧で編集できます。';
    };
    const qaFileLabel = element('label', '既存の想定問答JSONを読み込む ');
    const qaFile = element('input'); qaFile.type = 'file'; qaFile.accept = '.json'; qaFileLabel.append(qaFile);
    const phrasesLabel = element('label', '聞き返し・確認フレーズ（各行「英語<Tab>日本語」）');
    const phrasesInput = element('textarea'); phrasesInput.rows = 2; phrasesInput.placeholder = 'Could you please repeat the question?\tもう一度質問していただけますか。';
    phrasesLabel.append(phrasesInput);
    const upload = element('button', '選んだ資料で始める');
    const status = element('p', '', 'muted'); status.setAttribute('role', 'status');
    root.append(heading, description, fileLabel, folderLabel, githubLabel, selected, titleLabel, qaLabel, qaFields, qaFileLabel, phrasesLabel, upload, status);
    container.replaceChildren(root);
    let candidates = [];
    function display() {
      selected.replaceChildren();
      if (!candidates.length) { selected.append(element('p', '資料を選択してください。', 'muted')); return; }
      selected.append(element('p', '回答の根拠として使うファイルを選択'));
      for (const item of candidates) {
        const label = element('label');
        const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = !item.fromFolder; item.checkbox = checkbox;
        label.append(checkbox, document.createTextNode(' ' + item.path + ' (' + Math.ceil(item.file.size / 1024) + ' KB)'));
        selected.append(label, element('br'));
      }
    }
    async function choose(list) {
      candidates = [];
      display();
      status.textContent = '資料一覧を確認してください。';
      const files = [];
      const fromFolder = list === folderInput.files;
      for (const file of list) {
        if (extension(file.name) === 'zip') files.push(...await unpackZip(file, base));
        else files.push(file);
      }
      const filtered = files.map(file => ({ file, path: pathOf(file), fromFolder:fromFolder || !!file.webkitRelativePath }))
        .filter(({ path, file }) => safePath(path) && file.size <= MAX_FILE_BYTES)
      if (filtered.length > MAX_CANDIDATES) throw Error('対象候補は200件までです。フォルダーを小さくしてください。');
      candidates = filtered;
      const skipped = files.length - filtered.length;
      display();
      if (skipped) status.textContent = skipped + '件を対象外にしました。隠しファイル、鍵、依存ライブラリ、ビルド成果物、対象外形式、大きいファイルは取り込みません。';
    }
    githubButton.onclick = async () => {
      candidates = []; display(); githubButton.disabled = true;
      status.textContent = '公開リポジトリのファイル一覧を確認しています…';
      try {
        const url = new URL(githubInput.value);
        const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !match)
          throw Error('公開GitHubリポジトリのトップページURLを入力してください。');
        const owner = match[1], repo = match[2];
        const prefix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
        const metadata = await githubJson(prefix);
        if (metadata.private || !metadata.default_branch) throw Error('公開リポジトリを確認できません。');
        const commit = await githubJson(prefix + '/commits/' + encodeURIComponent(metadata.default_branch));
        const sha = commit.sha;
        if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('コミットを固定できません。');
        const tree = await githubJson(prefix + '/git/trees/' + sha + '?recursive=1');
        if (tree.truncated || !Array.isArray(tree.tree)) throw Error('リポジトリの一覧が大きすぎます。必要なフォルダーを手元で選択してください。');
        const blobs = tree.tree.filter(entry => entry.type === 'blob' && safePath(entry.path) &&
          Number.isSafeInteger(entry.size) && entry.size <= MAX_FILE_BYTES && /^[a-f0-9]{40}$/.test(entry.sha));
        if (blobs.length > MAX_CANDIDATES) throw Error('対象候補が200件を超えます。必要なフォルダーを手元で選択してください。');
        candidates = blobs.map(entry => {
          const name = entry.path.split('/').pop();
          let data;
          const read = async () => {
            if (data) return data;
            const blob = await githubJson(prefix + '/git/blobs/' + entry.sha);
            if (blob.sha !== entry.sha || blob.encoding !== 'base64' || blob.size !== entry.size)
              throw Error(entry.path + ' の内容を確認できません。');
            const binary = atob(blob.content.replace(/\s/g, ''));
            data = Uint8Array.from(binary, char => char.charCodeAt(0));
            if (data.length !== entry.size) throw Error(entry.path + ' のサイズが一致しません。');
            return data;
          };
          const file = { name, size:entry.size, webkitRelativePath:owner + '/' + repo + '@' + sha.slice(0, 12) + '/' + entry.path,
            arrayBuffer: async () => (await read()).buffer,
            text: async () => new TextDecoder().decode(await read()) };
          return { file, path:pathOf(file), fromFolder:true };
        });
        display();
        titleInput.value = owner + '/' + repo;
        status.textContent = candidates.length + '件の候補を表示しました。取得したコミット ' + sha.slice(0, 12) + ' の内容から使用するファイルを選んでください。';
      } catch (error) { status.textContent = error.message; }
      finally { githubButton.disabled = false; }
    };
    fileInput.onchange = () => choose(fileInput.files).catch(error => { status.textContent = error.message; });
    folderInput.onchange = () => choose(folderInput.files).catch(error => { status.textContent = error.message; });
    qaFile.onchange = async () => {
      try {
        if (!qaFile.files?.length) return;
        const file = qaFile.files[0];
        if (file.size > 1024 * 1024) throw Error('想定問答JSONは1 MBまでです。');
        const pack = JSON.parse(await file.text());
        const questions = Array.isArray(pack) ? pack : pack.qa;
        if (!Array.isArray(questions)) throw Error('JSONにはqa配列が必要です。');
        const qrows = questions.map(q => [q.question, q.answer, q.ja || '', q.cues || '', q.confirm || ''].map(s => String(s || '').replace(/[\t\r\n]/g, ' ')).join('\t'));
        qaInput.value += (qaInput.value.trim() ? '\n' : '') + qrows.join('\n');
        if (Array.isArray(pack.emergency)) {
          const erows = pack.emergency.map(q => [q.answer, q.ja || ''].map(s => String(s || '').replace(/[\t\r\n]/g, ' ')).join('\t'));
          phrasesInput.value += (phrasesInput.value.trim() ? '\n' : '') + erows.join('\n');
        }
        status.textContent = qrows.length + '件の想定問答を読み込みました。';
      } catch (error) { status.textContent = error.message; }
    };
    display();
    upload.onclick = async () => {
      upload.disabled = true; status.textContent = '資料を読み取っています…';
      try {
        const chosen = candidates.filter(item => item.checkbox.checked);
        if (!chosen.length) throw Error('資料を少なくとも1件選択してください。');
        if (chosen.length > MAX_FILES) throw Error('一度に使えるファイルは30件までです。');
        if (chosen.reduce((total, item) => total + item.file.size, 0) > MAX_TOTAL_BYTES) throw Error('選択したファイルの合計は24 MBまでです。');
        const sources = [], budget = { remaining: MAX_CHARS };
        for (const { file, path } of chosen) {
          const ext = extension(path);
          const label = path.slice(0, 190);
          if (ext === 'pdf') await parsePdf(file, base, sources, budget, label);
          else if (ext === 'pptx' || ext === 'docx') await parseOffice(file, base, sources, budget, label);
          else if (textTypes.has(ext)) await parseText(file, sources, budget, label);
          if (budget.remaining <= 0) throw Error('資料が長すぎます。重要なファイルを絞ってください（最大約7万字）。');
        }
        if (!sources.length) throw Error('読めるテキストがありません。画像だけのPDFはテキスト抽出できません。');
        const title = titleInput.value.trim() || (chosen.length === 1 ? chosen[0].path : chosen[0].path.split('/')[0]);
        const pack = { title: title.slice(0, 240), sources, qa: parseRows(qaInput.value, 'qa'), emergency: parseRows(phrasesInput.value, 'emergency') };
        if (new TextEncoder().encode(JSON.stringify(pack)).length > 350 * 1024) throw Error('資料が大きすぎます。ファイルを絞ってください。');
        status.textContent = sources.length + '件の抜粋を用意しました。';
        await onReady(pack);
      } catch (error) { status.textContent = error.message; }
      finally { upload.disabled = false; }
    };
    return root;
  }
  window.QAImport = { mount };
})();
