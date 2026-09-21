const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mp3info = require('./mp3-info');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'playlists.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 300 },
});

app.use(express.json({ limit: '2mb' }));

// ---------- optional single-password auth ----------
// Off by default. Set APP_PASSWORD to require a password before anyone can
// use the app — fine for "don't let just anyone on my network in," not a
// substitute for real multi-user auth.

const APP_PASSWORD = process.env.APP_PASSWORD || '';
const validSessions = new Set();

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function loginPageHtml() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tracklist — Log in</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#1b2430; font-family: ui-monospace, monospace; }
  .box { background:#efe7d6; padding:32px 30px; border-radius:12px; width:280px; box-shadow:0 10px 30px rgba(0,0,0,0.3); }
  h1 { font-family: Georgia, serif; font-size:22px; margin:0 0 18px; color:#1b2430; }
  .pw-row { position:relative; margin-bottom:10px; }
  .pw-row input { width:100%; box-sizing:border-box; padding:10px 40px 10px 10px; border-radius:6px; border:1px solid rgba(27,36,48,0.2); font-family:inherit; font-size:13px; }
  .pw-toggle { position:absolute; top:0; right:0; width:36px; height:100%; background:none; border:none; padding:0; cursor:pointer; color:rgba(27,36,48,0.5); font-size:14px; }
  .pw-toggle:hover { color:#1b2430; }
  button[type="submit"] { width:100%; padding:10px; border-radius:6px; border:none; background:#1b2430; color:#efe7d6; font-family:inherit; font-size:13px; cursor:pointer; }
  .err { color:#b3492f; font-size:12px; margin:0 0 10px; min-height:14px; }
</style></head>
<body>
  <form class="box" id="f">
    <h1>♪ Tracklist</h1>
    <p class="err" id="err"></p>
    <div class="pw-row">
      <input type="password" id="pw" placeholder="Password" autofocus />
      <button type="button" class="pw-toggle" id="pw-toggle" title="Show password" aria-label="Show password">👁</button>
    </div>
    <button type="submit">Log in</button>
  </form>
  <script>
    document.getElementById('pw-toggle').addEventListener('click', () => {
      const pw = document.getElementById('pw');
      const toggle = document.getElementById('pw-toggle');
      const showing = pw.type === 'text';
      pw.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? '👁' : '🙈';
      toggle.title = showing ? 'Show password' : 'Hide password';
      pw.focus();
    });
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: document.getElementById('pw').value }) });
      const data = await res.json();
      if (data.ok) { window.location.href = '/'; }
      else { document.getElementById('err').textContent = data.error || 'Incorrect password'; }
    });
  </script>
</body></html>`;
}

app.get('/login', (req, res) => {
  if (!APP_PASSWORD) return res.redirect('/');
  res.type('html').send(loginPageHtml());
});

app.post('/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  const submitted = (req.body && req.body.password) || '';
  let ok = false;
  if (submitted.length === APP_PASSWORD.length) {
    ok = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(APP_PASSWORD));
  }
  if (!ok) return res.status(401).json({ ok: false, error: 'Incorrect password' });
  const token = crypto.randomBytes(24).toString('hex');
  validSessions.add(token);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.session) validSessions.delete(cookies.session);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.status(204).end();
});

app.get('/api/auth-status', (req, res) => {
  res.json({ enabled: !!APP_PASSWORD });
});

app.use((req, res, next) => {
  if (!APP_PASSWORD || req.path === '/login' || req.path === '/logout') return next();
  const cookies = parseCookies(req);
  if (cookies.session && validSessions.has(cookies.session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage helpers ----------

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
}

function readAll() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read data file, resetting.', e);
    return {};
  }
}

function writeAll(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function id() {
  return crypto.randomBytes(6).toString('hex');
}

// Every playlist gets a stable internal id (independent of its display
// name) so its audio folder survives renames. Assigned lazily for
// playlists created before this existed.
function ensurePlaylistId(all, name) {
  const pl = all[name];
  if (!pl.id) {
    pl.id = id();
    writeAll(all);
  }
  return pl.id;
}

function playlistAudioDir(plId) {
  return path.join(AUDIO_DIR, plId);
}

function playlistPoolDir(plId) {
  return path.join(AUDIO_DIR, plId, '_pool');
}

// Parse pasted text into track objects.
function parseImportText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((rawLine, i) => {
    let line = rawLine.replace(/^\s*\d+[\.\)]\s*/, '');
    let artist = '';
    let title = line;

    const dashMatch = line.match(/^(.+?)\s+-\s+(.+)$/);
    const parenMatch = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/);

    if (dashMatch) {
      artist = dashMatch[1].trim();
      title = dashMatch[2].trim();
    } else if (parenMatch) {
      title = parenMatch[1].trim();
      artist = parenMatch[2].trim();
    }

    return { id: id(), title, artist, audioFile: null, durationSec: null, createdAt: Date.now() + i };
  });
}

// ---------- filename <-> track matching ----------

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, '') // strip extension
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const MATCH_THRESHOLD = 0.34;

function analyzeAudioBuffer(buf) {
  let tags = null;
  let durationSec = null;
  try { tags = mp3info.readTags(buf); } catch (e) {}
  try { durationSec = mp3info.estimateDurationSeconds(buf); } catch (e) {}
  return { tags, durationSec };
}

function matchFilesToTracks(files, tracks) {
  // files: [{ originalname, tags? }], tracks: [{ id, title, artist }]
  const fileSets = files.map((f) => {
    const fromName = tokenSet(f.originalname);
    if (f.tags && (f.tags.title || f.tags.artist)) {
      const fromTags = tokenSet(`${f.tags.artist || ''} ${f.tags.title || ''}`);
      return { fromName, fromTags };
    }
    return { fromName, fromTags: null };
  });
  const pairs = [];
  files.forEach((f, fi) => {
    tracks.forEach((t) => {
      const combined = tokenSet(`${t.artist || ''} ${t.title}`);
      const titleOnly = tokenSet(t.title);
      let score = Math.max(jaccard(fileSets[fi].fromName, combined), jaccard(fileSets[fi].fromName, titleOnly));
      if (fileSets[fi].fromTags) {
        // embedded ID3 tags are a stronger signal than the filename when present
        score = Math.max(score, jaccard(fileSets[fi].fromTags, combined) * 1.15);
      }
      if (score >= MATCH_THRESHOLD) pairs.push({ fi, trackId: t.id, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const usedFiles = new Set();
  const usedTracks = new Set();
  const matches = [];
  for (const p of pairs) {
    if (usedFiles.has(p.fi) || usedTracks.has(p.trackId)) continue;
    usedFiles.add(p.fi);
    usedTracks.add(p.trackId);
    matches.push(p);
  }
  return { matches, usedFiles };
}

function trackKey(t) {
  return normalize(`${t.artist || ''} ${t.title}`);
}

function safePoolName(originalname) {
  return `${id()}__${originalname.replace(/[^\w.\-]+/g, '_')}`;
}

const DELETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Soft-deleted playlists are kept in the same store under a key that can't
// collide with a real (user-typed) playlist name, so all the existing
// `all[name]` code paths keep working unchanged.
function deletedKeyFor(name) {
  return `\u0000deleted\u0000${Date.now()}\u0000${name}`;
}

function purgeExpiredDeleted(all) {
  let changed = false;
  Object.keys(all).forEach((key) => {
    const pl = all[key];
    if (pl && pl.deleted && pl.deletedAt) {
      const age = Date.now() - new Date(pl.deletedAt).getTime();
      if (age > DELETED_RETENTION_MS) {
        if (pl.id) { try { fs.rmSync(playlistAudioDir(pl.id), { recursive: true, force: true }); } catch (e) {} }
        delete all[key];
        changed = true;
      }
    }
  });
  return changed;
}

function cleanupOrphanedAudio(plId, keepTracks) {
  const dir = playlistAudioDir(plId);
  if (!fs.existsSync(dir)) return;
  const keepIds = new Set(keepTracks.map((t) => t.id));
  fs.readdirSync(dir).forEach((entry) => {
    if (entry === '_pool') return;
    const trackId = entry.replace(/\.mp3$/i, '');
    if (!keepIds.has(trackId)) {
      try { fs.unlinkSync(path.join(dir, entry)); } catch (e) {}
    }
  });
}

// ---------- playlist CRUD ----------

app.get('/api/playlists', (req, res) => {
  const all = readAll();
  if (purgeExpiredDeleted(all)) writeAll(all);
  const summary = Object.entries(all)
    .filter(([, pl]) => !pl.deleted)
    .map(([name, pl]) => ({
      name,
      count: (pl.tracks || []).length,
      audioCount: (pl.tracks || []).filter((t) => t.audioFile).length,
      folder: pl.folder || null,
      hasCover: !!pl.cover,
      updatedAt: pl.updatedAt || null,
    }));
  res.json(summary);
});

app.get('/api/playlists/:name', (req, res) => {
  const all = readAll();
  const pl = all[req.params.name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  res.json({
    name: req.params.name,
    tracks: pl.tracks || [],
    poolFiles: pl.poolFiles || [],
    folder: pl.folder || null,
    cover: pl.cover || null,
  });
});

app.post('/api/playlists', (req, res) => {
  const { name, folder } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const all = readAll();
  if (all[name]) return res.status(409).json({ error: 'Playlist already exists' });
  all[name] = {
    id: id(),
    tracks: [],
    poolFiles: [],
    folder: folder && folder.trim() ? folder.trim() : null,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
  res.status(201).json({ name, tracks: [] });
});

app.put('/api/playlists/:name/folder', (req, res) => {
  const { folder } = req.body;
  const all = readAll();
  const name = req.params.name;
  if (!all[name]) return res.status(404).json({ error: 'Playlist not found' });
  all[name].folder = folder && folder.trim() ? folder.trim() : null;
  writeAll(all);
  res.json({ folder: all[name].folder });
});

app.post('/api/playlists/:name/import', (req, res) => {
  const { text, mode } = req.body;
  if (typeof text !== 'string') return res.status(400).json({ error: 'text is required' });

  const all = readAll();
  const name = req.params.name;
  if (!all[name]) all[name] = { id: id(), tracks: [], poolFiles: [], updatedAt: new Date().toISOString() };

  const plId = ensurePlaylistId(all, name);
  const imported = parseImportText(text);

  const existing = mode === 'append' ? all[name].tracks || [] : [];
  const seenKeys = new Set(existing.map(trackKey).filter(Boolean));
  const deduped = [];
  let duplicatesSkipped = 0;
  imported.forEach((t) => {
    const key = trackKey(t);
    if (key && seenKeys.has(key)) {
      duplicatesSkipped++;
      return;
    }
    if (key) seenKeys.add(key);
    deduped.push(t);
  });

  if (mode === 'append') {
    all[name].tracks = [...existing, ...deduped];
  } else {
    all[name].tracks = deduped;
    cleanupOrphanedAudio(plId, all[name].tracks); // replacing drops orphaned audio
  }
  all[name].updatedAt = new Date().toISOString();
  writeAll(all);
  res.json({ name, tracks: all[name].tracks, duplicatesSkipped });
});

app.put('/api/playlists/:name', (req, res) => {
  const { tracks } = req.body;
  if (!Array.isArray(tracks)) return res.status(400).json({ error: 'tracks must be an array' });
  const all = readAll();
  const name = req.params.name;
  if (!all[name]) return res.status(404).json({ error: 'Playlist not found' });

  const plId = ensurePlaylistId(all, name);

  all[name].tracks = tracks.map((t) => ({
    id: t.id || id(),
    title: (t.title || '').trim(),
    artist: (t.artist || '').trim(),
    audioFile: t.audioFile || null,
    durationSec: typeof t.durationSec === 'number' ? t.durationSec : null,
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
  }));
  cleanupOrphanedAudio(plId, all[name].tracks);
  all[name].updatedAt = new Date().toISOString();
  writeAll(all);
  res.json({ name, tracks: all[name].tracks });
});

app.put('/api/playlists/:name/rename', (req, res) => {
  const { newName } = req.body;
  const all = readAll();
  const name = req.params.name;
  if (!all[name]) return res.status(404).json({ error: 'Playlist not found' });
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'newName is required' });
  if (all[newName]) return res.status(409).json({ error: 'A playlist with that name already exists' });

  all[newName] = all[name];
  delete all[name];
  writeAll(all);
  res.json({ name: newName, tracks: all[newName].tracks });
});

app.post('/api/playlists/:name/duplicate', (req, res) => {
  const { newName } = req.body;
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  if (!newName || !newName.trim()) return res.status(400).json({ error: 'newName is required' });
  if (all[newName]) return res.status(409).json({ error: 'A playlist with that name already exists' });

  const oldPlId = ensurePlaylistId(all, name);
  const oldTracks = pl.tracks || [];
  const newTracks = oldTracks.map((t) => ({ ...t, id: id() }));
  const newPlId = id();

  all[newName] = { id: newPlId, tracks: newTracks, poolFiles: [], folder: pl.folder || null, cover: pl.cover || null, updatedAt: new Date().toISOString() };
  writeAll(all);

  const oldDir = playlistAudioDir(oldPlId);
  const newDir = playlistAudioDir(newPlId);
  fs.mkdirSync(newDir, { recursive: true });
  oldTracks.forEach((t, i) => {
    if (!t.audioFile) return;
    const src = path.join(oldDir, `${t.id}.mp3`);
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, path.join(newDir, `${newTracks[i].id}.mp3`)); } catch (e) {}
    }
  });
  if (pl.cover) {
    const coverSrc = path.join(oldDir, pl.cover.filename);
    if (fs.existsSync(coverSrc)) {
      try { fs.copyFileSync(coverSrc, path.join(newDir, pl.cover.filename)); } catch (e) {}
    }
  }

  res.status(201).json({ name: newName, tracks: newTracks });
});

app.delete('/api/playlists/:name', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  if (!all[name]) return res.status(404).json({ error: 'Playlist not found' });
  const pl = all[name];
  pl.deleted = true;
  pl.deletedAt = new Date().toISOString();
  pl.originalName = name;
  all[deletedKeyFor(name)] = pl;
  delete all[name];
  writeAll(all);
  res.status(204).end();
});

app.get('/api/deleted-playlists', (req, res) => {
  const all = readAll();
  if (purgeExpiredDeleted(all)) writeAll(all);
  const list = Object.entries(all)
    .filter(([, pl]) => pl.deleted)
    .map(([key, pl]) => ({
      key,
      name: pl.originalName,
      count: (pl.tracks || []).length,
      deletedAt: pl.deletedAt,
    }))
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.json(list);
});

app.post('/api/deleted-playlists/:key/restore', (req, res) => {
  const all = readAll();
  const key = req.params.key;
  const pl = all[key];
  if (!pl || !pl.deleted) return res.status(404).json({ error: 'Not found in recently deleted' });

  let restoreName = pl.originalName;
  if (all[restoreName]) {
    let n = 2;
    restoreName = `${pl.originalName} (restored)`;
    while (all[restoreName]) restoreName = `${pl.originalName} (restored ${n++})`;
  }
  delete pl.deleted;
  delete pl.deletedAt;
  delete pl.originalName;
  all[restoreName] = pl;
  delete all[key];
  writeAll(all);
  res.json({ name: restoreName });
});

app.delete('/api/deleted-playlists/:key', (req, res) => {
  const all = readAll();
  const key = req.params.key;
  const pl = all[key];
  if (!pl || !pl.deleted) return res.status(404).json({ error: 'Not found in recently deleted' });
  if (pl.id) { try { fs.rmSync(playlistAudioDir(pl.id), { recursive: true, force: true }); } catch (e) {} }
  delete all[key];
  writeAll(all);
  res.status(204).end();
});

// ---------- whole-library backup / restore ----------
// Covers playlists, tracks, order, and folders — not the attached audio
// binaries themselves (those live in the Docker volume). Restoring onto
// the same volume that made the backup will still have audio linked up,
// since track/playlist ids are preserved and checked against disk.

app.get('/api/backup', (req, res) => {
  const all = readAll();
  const playlists = {};
  Object.entries(all).forEach(([name, pl]) => {
    if (pl.deleted) return; // don't back up the recently-deleted bin
    playlists[name] = { id: pl.id, tracks: pl.tracks || [], folder: pl.folder || null };
  });
  res.setHeader('Content-Disposition', 'attachment; filename="tracklist-backup.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), playlists });
});

app.post('/api/backup/restore', (req, res) => {
  const { mode, playlists } = req.body;
  if (!playlists || typeof playlists !== 'object') {
    return res.status(400).json({ error: 'That doesn\'t look like a Tracklist backup file' });
  }
  const all = readAll();
  if (mode === 'replace') {
    Object.keys(all).forEach((k) => { if (!all[k].deleted) delete all[k]; }); // keep the recently-deleted bin intact
  }

  let added = 0;
  const skipped = [];
  Object.entries(playlists).forEach(([name, pl]) => {
    if (all[name]) { skipped.push(name); return; }
    const plId = pl.id || id();
    const restoredTracks = (Array.isArray(pl.tracks) ? pl.tracks : []).map((t) => {
      const audioExists = fs.existsSync(path.join(playlistAudioDir(plId), `${t.id}.mp3`));
      return {
        id: t.id || id(),
        title: t.title || '',
        artist: t.artist || '',
        audioFile: audioExists ? t.audioFile || null : null,
        durationSec: audioExists && typeof t.durationSec === 'number' ? t.durationSec : null,
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
      };
    });
    all[name] = {
      id: plId,
      tracks: restoredTracks,
      poolFiles: [],
      folder: pl.folder || null,
      updatedAt: new Date().toISOString(),
    };
    added++;
  });

  writeAll(all);
  res.json({ added, skipped });
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const all = readAll();
  const results = [];
  Object.entries(all).forEach(([name, pl]) => {
    (pl.tracks || []).forEach((t) => {
      if (t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)) {
        results.push({ playlistName: name, track: t });
      }
    });
  });
  res.json(results.slice(0, 50));
});

// ---------- cover art ----------

app.post('/api/playlists/:name/cover', upload.single('cover'), (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const mime = req.file.mimetype;
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : null;
  if (!ext) return res.status(400).json({ error: 'Only JPEG or PNG images are supported' });

  const plId = ensurePlaylistId(all, name);
  const dir = playlistAudioDir(plId);
  fs.mkdirSync(dir, { recursive: true });
  ['jpg', 'png'].forEach((e) => { try { fs.unlinkSync(path.join(dir, `cover.${e}`)); } catch (err) {} });
  fs.writeFileSync(path.join(dir, `cover.${ext}`), req.file.buffer);

  pl.cover = { mime, filename: `cover.${ext}` };
  writeAll(all);
  res.json({ cover: pl.cover });
});

app.get('/api/playlists/:name/cover', (req, res) => {
  const all = readAll();
  const pl = all[req.params.name];
  if (!pl || !pl.cover) return res.status(404).end();
  const plId = ensurePlaylistId(all, req.params.name);
  const filePath = path.join(playlistAudioDir(plId), pl.cover.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader('Content-Type', pl.cover.mime);
  fs.createReadStream(filePath).pipe(res);
});

app.delete('/api/playlists/:name/cover', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  if (pl.cover) {
    const plId = ensurePlaylistId(all, name);
    try { fs.unlinkSync(path.join(playlistAudioDir(plId), pl.cover.filename)); } catch (e) {}
    pl.cover = null;
  }
  writeAll(all);
  res.json({ cover: null });
});

app.get('/api/playlists/:name/export', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  const format = (req.query.format || 'txt').toLowerCase();
  const tracks = pl.tracks || [];

  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
    return res.json({ name, tracks });
  }

  if (format === 'm3u') {
    const lines = ['#EXTM3U'];
    tracks.forEach((t) => {
      const label = t.artist ? `${t.artist} - ${t.title}` : t.title;
      lines.push(`#EXTINF:-1,${label}`);
      lines.push(label);
    });
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.m3u"`);
    return res.send(lines.join('\n'));
  }

  if (format === 'cue') {
    const tracksWithAudio = tracks.filter((t) => t.audioFile);
    if (!tracksWithAudio.length) {
      return res.status(400).json({ error: 'Attach MP3s and export the audio .zip before generating a .cue sheet' });
    }
    const pad = Math.max(4, String(tracksWithAudio.length).length);
    const lines = [];
    tracksWithAudio.forEach((t, i) => {
      const num = String(i + 1).padStart(pad, '0');
      lines.push(`FILE "${num}.mp3" MP3`);
      lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`);
      lines.push(`    TITLE "${(t.title || '').replace(/"/g, "'")}"`);
      if (t.artist) lines.push(`    PERFORMER "${t.artist.replace(/"/g, "'")}"`);
      lines.push(`    INDEX 01 00:00:00`);
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.cue"`);
    return res.send(lines.join('\n'));
  }

  const lines = tracks.map((t) => (t.artist ? `${t.artist} - ${t.title}` : t.title));
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.txt"`);
  res.send(lines.join('\n'));
});

// ---------- audio: single-track attach/remove ----------

app.post('/api/playlists/:name/tracks/:trackId/audio', upload.single('file'), (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  const track = (pl.tracks || []).find((t) => t.id === req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!/\.mp3$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Only .mp3 files are supported' });
  }

  const plId = ensurePlaylistId(all, name);
  const dir = playlistAudioDir(plId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${track.id}.mp3`), req.file.buffer);

  const { tags, durationSec } = analyzeAudioBuffer(req.file.buffer);
  track.audioFile = req.file.originalname;
  track.durationSec = durationSec;
  if (tags) {
    if (!track.title && tags.title) track.title = tags.title;
    if (!track.artist && tags.artist) track.artist = tags.artist;
  }
  all[name].updatedAt = new Date().toISOString();
  writeAll(all);
  res.json({ track });
});

app.delete('/api/playlists/:name/tracks/:trackId/audio', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  const track = (pl.tracks || []).find((t) => t.id === req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const plId = ensurePlaylistId(all, name);
  const filePath = path.join(playlistAudioDir(plId), `${track.id}.mp3`);
  try { fs.unlinkSync(filePath); } catch (e) {}
  track.audioFile = null;
  track.durationSec = null;
  writeAll(all);
  res.json({ track });
});

// ---------- audio: bulk upload + auto-match ----------

app.post('/api/playlists/:name/audio/bulk', upload.array('files', 300), (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  const files = req.files || [];
  const mp3Files = files.filter((f) => /\.mp3$/i.test(f.originalname));
  const skippedNonMp3 = files.length - mp3Files.length;

  const plId = ensurePlaylistId(all, name);
  const dir = playlistAudioDir(plId);
  const poolDir = playlistPoolDir(plId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(poolDir, { recursive: true });

  const unassignedTracks = (pl.tracks || []).filter((t) => !t.audioFile);

  // read ID3 tags up front so matching can use them alongside filenames
  const analyzed = mp3Files.map((f) => ({ ...f, ...analyzeAudioBuffer(f.buffer) }));

  const { matches, usedFiles } = matchFilesToTracks(
    analyzed.map((f) => ({ originalname: f.originalname, tags: f.tags })),
    unassignedTracks
  );

  matches.forEach((m) => {
    const f = analyzed[m.fi];
    fs.writeFileSync(path.join(dir, `${m.trackId}.mp3`), f.buffer);
    const track = pl.tracks.find((t) => t.id === m.trackId);
    track.audioFile = f.originalname;
    track.durationSec = f.durationSec;
    if (f.tags) {
      if (!track.title && f.tags.title) track.title = f.tags.title;
      if (!track.artist && f.tags.artist) track.artist = f.tags.artist;
    }
  });

  const unmatched = [];
  analyzed.forEach((f, fi) => {
    if (usedFiles.has(fi)) return;
    const poolName = safePoolName(f.originalname);
    fs.writeFileSync(path.join(poolDir, poolName), f.buffer);
    const entry = { poolName, originalName: f.originalname, durationSec: f.durationSec, tags: f.tags };
    pl.poolFiles = pl.poolFiles || [];
    pl.poolFiles.push(entry);
    unmatched.push(entry);
  });

  pl.updatedAt = new Date().toISOString();
  writeAll(all);

  res.json({
    matchedCount: matches.length,
    skippedNonMp3,
    unmatched,
    tracks: pl.tracks,
    poolFiles: pl.poolFiles || [],
  });
});

app.post('/api/playlists/:name/tracks/:trackId/audio/from-pool', (req, res) => {
  const { poolName } = req.body;
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  const track = (pl.tracks || []).find((t) => t.id === req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const entry = (pl.poolFiles || []).find((p) => p.poolName === poolName);
  if (!entry) return res.status(404).json({ error: 'Pool file not found' });

  const plId = ensurePlaylistId(all, name);
  const src = path.join(playlistPoolDir(plId), poolName);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Pool file missing on disk' });
  const dest = path.join(playlistAudioDir(plId), `${track.id}.mp3`);
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);

  pl.poolFiles = pl.poolFiles.filter((p) => p.poolName !== poolName);
  track.audioFile = entry.originalName;
  track.durationSec = typeof entry.durationSec === 'number' ? entry.durationSec : null;
  if (entry.tags) {
    if (!track.title && entry.tags.title) track.title = entry.tags.title;
    if (!track.artist && entry.tags.artist) track.artist = entry.tags.artist;
  }
  writeAll(all);
  res.json({ track, poolFiles: pl.poolFiles });
});

app.delete('/api/playlists/:name/pool/:poolName', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });
  const plId = ensurePlaylistId(all, name);
  const src = path.join(playlistPoolDir(plId), req.params.poolName);
  try { fs.unlinkSync(src); } catch (e) {}
  pl.poolFiles = (pl.poolFiles || []).filter((p) => p.poolName !== req.params.poolName);
  writeAll(all);
  res.json({ poolFiles: pl.poolFiles });
});

// ---------- audio: streaming (for inline preview playback) ----------

app.get('/api/playlists/:name/tracks/:trackId/audio/file', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).end();
  const track = (pl.tracks || []).find((t) => t.id === req.params.trackId);
  if (!track || !track.audioFile) return res.status(404).end();

  const plId = ensurePlaylistId(all, name);
  const filePath = path.join(playlistAudioDir(plId), `${track.id}.mp3`);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(res);
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
  if (start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
    return res.end();
  }
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

// ---------- audio: numbered zip export ----------

app.get('/api/playlists/:name/export-audio', (req, res) => {
  const all = readAll();
  const name = req.params.name;
  const pl = all[name];
  if (!pl) return res.status(404).json({ error: 'Playlist not found' });

  const plId = ensurePlaylistId(all, name);
  const dir = playlistAudioDir(plId);
  const tracksWithAudio = (pl.tracks || []).filter(
    (t) => t.audioFile && fs.existsSync(path.join(dir, `${t.id}.mp3`))
  );

  if (!tracksWithAudio.length) {
    return res.status(400).json({ error: 'No MP3s attached to this playlist yet' });
  }

  const pad = Math.max(4, String(tracksWithAudio.length).length);
  const safeName = name.replace(/[^\w.\- ]+/g, '_');

  let coverPicture = null;
  if (pl.cover) {
    try {
      const coverPath = path.join(dir, pl.cover.filename);
      if (fs.existsSync(coverPath)) coverPicture = { mime: pl.cover.mime, data: fs.readFileSync(coverPath) };
    } catch (e) {}
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-audio.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Archive error', err);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);

  const manifestLines = [];
  tracksWithAudio.forEach((t, i) => {
    const num = String(i + 1).padStart(pad, '0');
    const filePath = path.join(dir, `${t.id}.mp3`);
    let fileBuf;
    try {
      fileBuf = mp3info.writeId3v2(fs.readFileSync(filePath), { title: t.title, artist: t.artist, picture: coverPicture });
    } catch (e) {
      fileBuf = fs.readFileSync(filePath); // fall back to the untagged original if writing fails
    }
    archive.append(fileBuf, { name: `${num}.mp3` });
    manifestLines.push(`${num}.mp3  \u2014  ${t.artist ? `${t.artist} - ${t.title}` : t.title}`);
  });
  archive.append(manifestLines.join('\n'), { name: 'tracklist.txt' });

  archive.finalize();
});

// multer / upload error handler
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Playlist editor running at http://localhost:${PORT}`);
  if (APP_PASSWORD === 'changeme') {
    console.warn('');
    console.warn('⚠️  WARNING: APP_PASSWORD is still set to the default "changeme".');
    console.warn('   Anyone who knows that can log in. Set a real password in');
    console.warn('   docker-compose.yml (or unset it entirely to disable the login screen).');
    console.warn('');
  } else if (!APP_PASSWORD) {
    console.log('Login screen is disabled (APP_PASSWORD is not set).');
  }
});
