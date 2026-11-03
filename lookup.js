// Name a song from a link, with free keyless lookups only (YouTube oEmbed, Spotify oEmbed, iTunes Search).
// Mettu never downloads audio from these services; it only reads the public title and points to licensed sources.
const Lookup = (() => {
  function parse(raw) {
    let u;
    try { u = new URL(raw.trim().replace(/^(?!https?:)/, 'https://')); } catch { return { kind: 'none' }; }
    const h = u.hostname.replace(/^(www|m)\./, '');
    if (/^(youtube\.com|music\.youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(h)) {
      let id = h === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
      if (!id) { const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{6,})/); if (m) id = m[2]; }
      return id ? { kind: 'youtube', id: id.slice(0, 20), url: `https://www.youtube.com/watch?v=${id.slice(0, 20)}`, music: h.startsWith('music.') } : { kind: 'unknown', host: h };
    }
    if (/^(open\.spotify\.com|spotify\.link|spotify\.com)$/.test(h)) {
      const m = u.pathname.match(/\/(?:intl-[a-z]{2}\/)?(track|album|artist|playlist|episode)\/([A-Za-z0-9]+)/);
      return m ? { kind: 'spotify', type: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` } : { kind: h === 'spotify.link' ? 'spotify-short' : 'unknown', host: h };
    }
    if (/^(instagram\.com|instagr\.am)$/.test(h)) return { kind: 'instagram', reel: /\/(reel|reels|p|tv)\//.test(u.pathname) };
    if (/^(jiosaavn\.com|music\.apple\.com|music\.amazon\.[a-z.]+|gaana\.com|wynk\.in)$/.test(h)) return { kind: 'store', host: h, url: u.href };
    return { kind: 'unknown', host: h };
  }

  // "Artist - Song (Official Video) | Film | Singer" → { song, artist, extra }
  function clean(title, author) {
    let t = title.replace(/\s*[([](official|lyric|lyrical|full|video|audio|4k|hd|hq|music video|visualizer|from)[^)\]]*[)\]]/gi, '')
      .replace(/#\S+/g, '').trim();
    const parts = t.split(/\s+[|]\s+/);
    let song = parts[0], artist = '';
    const extra = parts.slice(1).map(s => s.trim()).filter(Boolean);
    const dash = song.split(/\s+[-–—]\s+/);
    if (dash.length >= 2) { artist = dash[0].trim(); song = dash.slice(1).join(' - '); }
    song = song.replace(/\s*(official\s+)?(lyric(al)?\s+)?(full\s+)?(music\s+)?(video|audio)(\s+song)?\s*$/i, '').replace(/\s*[-–—|]\s*$/, '').replace(/^"|"$/g, '').trim();
    if (!song) { song = artist; artist = ''; }
    else if (artist) { extra.unshift(artist); if (parts.length > 1) artist = ''; } // "Film - Song | Cast" is the Indian convention
    if (!artist && author && !/official|music|records|films|studios|tv|channel|entertainment/i.test(author)) artist = author.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    return { song, artist, extra };
  }

  // Prefer catalogue matches whose artist appears in the original title.
  const rank = (matches, title) => {
    const words = new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2));
    const score = m => m.artist.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => words.has(w)).length;
    return matches.map(m => ({ ...m, hit: score(m) })).sort((a, b) => b.hit - a.hit);
  };

  async function itunes(term) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=4&country=IN`);
      if (!r.ok) return [];
      return (await r.json()).results.map(x => ({ song: x.trackName, artist: x.artistName, album: x.collectionName, art: x.artworkUrl100?.replace('100x100', '300x300'), store: x.trackViewUrl, year: (x.releaseDate || '').slice(0, 4) }));
    } catch { return []; }
  }

  async function identify(raw) {
    const p = parse(raw);
    if (p.kind === 'youtube') {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(p.url)}`);
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'private' : 'notfound');
      const j = await r.json();
      const c = clean(j.title, j.author_name);
      let matches = await itunes(c.song.slice(0, 100));
      if (!matches.length && c.extra.length) matches = await itunes(`${c.song} ${c.extra[0]}`.slice(0, 100));
      matches = rank(matches, j.title);
      const artist = matches[0]?.hit ? matches[0].artist : c.artist;
      return { ...p, source: 'YouTube', title: j.title, channel: j.author_name, thumb: j.thumbnail_url, song: c.song, artist, extra: c.extra, matches };
    }
    if (p.kind === 'spotify') {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(p.url)}`);
      if (!r.ok) throw new Error('notfound');
      const j = await r.json();
      const matches = p.type === 'track' ? await itunes(j.title) : [];
      return { ...p, source: 'Spotify', title: j.title, thumb: j.thumbnail_url, song: j.title, artist: '', extra: [], matches };
    }
    return p;
  }

  const q = s => encodeURIComponent(s.trim());
  function stores(song, artist) {
    const term = [song, artist].filter(Boolean).join(' ');
    return [
      { name: 'YouTube Music', note: 'stream', url: `https://music.youtube.com/search?q=${q(term)}` },
      { name: 'Spotify', note: 'stream', url: `https://open.spotify.com/search/${q(term)}` },
      { name: 'JioSaavn', note: 'stream', url: `https://www.jiosaavn.com/search/${q(term)}` },
      { name: 'Apple Music', note: 'stream', url: `https://music.apple.com/in/search?term=${q(term)}` },
      { name: 'Amazon Music', note: 'stream', url: `https://music.amazon.in/search/${q(term)}` },
    ];
  }

  return { parse, identify, stores, clean, itunes, rank };
})();
