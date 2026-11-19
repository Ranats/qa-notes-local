const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function loadPack(pack = JSON.parse(read('presentation.json'))) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw Error('Invalid presentation.');
  if (pack.title === undefined) pack.title = '自分の発表';
  if (typeof pack.title !== 'string' || !pack.title.trim() || pack.title.length > 240) throw Error('Presentation title is invalid.');
  const used = new Set();
  function validate(rows, group, fields, withId) {
    if (!Array.isArray(rows)) throw Error(group + ' must be an array.');
    for (const [i, row] of rows.entries()) {
      for (const field of fields) {
        if (typeof row?.[field] !== 'string' || !row[field].trim()) {
          throw Error(group + '[' + i + '].' + field + ' is required.');
        }
      }
      if (withId) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(row.id) || used.has(row.id)) {
          throw Error('IDs must be unique short identifiers: ' + row.id);
        }
        used.add(row.id);
      }
    }
  }
  validate(pack.sources, 'sources', ['id','title','text'], true);
  validate(pack.qa, 'qa', ['id','title','question','cues','answer','ja','source'], true);
  validate(pack.emergency, 'emergency', ['title','answer','ja'], false);
  if (!pack.sources.length) throw Error('Provide at least one source in presentation.json.');
  if (pack.sources.length > 320 || pack.qa.length > 64 || pack.emergency.length > 24) throw Error('Too many presentation entries.');
  if (pack.sources.some(s => s.text.length > 4000 || s.title.length > 240) ||
      pack.qa.some(q => q.answer.length > 3000 || q.ja.length > 3000 || q.title.length > 240) ||
      Buffer.byteLength(JSON.stringify(pack)) > 350 * 1024) throw Error('Presentation is too large.');
  const sources = [...pack.sources, ...pack.qa.map(q => ({
    id:q.id, title:q.title + ' · ' + q.source, text:q.answer + '\n' + q.ja
  }))];
  return {sources, data:{title:pack.title, qa:pack.qa, emergency:pack.emergency}};
}

function renderPage(data, mode = 'hai', version = 'hai') {
  const literal = JSON.stringify(data).replace(/</g, '\\u003c');
  const logic = 'let DATA=' + literal + ';const MODE=' + JSON.stringify(mode) + ';const SOURCE_VERSION=' + JSON.stringify(version) + ';\n' + read('client.js') + '\n' + read('audio-client.js');
  return read('template.html').replace('/*LOGIC*/', () => logic);
}

function writeOffline() {
  fs.writeFileSync(path.join(__dirname, 'QA_Notes.html'), renderPage(loadPack().data));
}

if (require.main === module) writeOffline();
module.exports = {loadPack, renderPage, writeOffline};

