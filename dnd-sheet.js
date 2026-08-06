/* ==========================================================================
   D&D 5e Character Sheet — Gold Edition
   Renders a D&D Beyond-style sheet from the unofficial character-service
   JSON payload: https://character-service.dndbeyond.com/character/v5/character/{id}

   IMPORTANT — read before wiring this into a live site:
   1. This is an UNOFFICIAL, undocumented endpoint. It can change or break
      without notice, and it only returns data for characters whose D&D
      Beyond privacy setting is "Public". Anything set to "Private" or
      "Friends Only" will 401/403 here.
   2. character-service.dndbeyond.com never sends CORS headers for outside
      origins — even D&D Beyond's own front-end hits this — so a direct
      browser fetch() to it will always fail. A public proxy (corsproxy.io,
      allorigins.win, etc.) can work around that, but they're unauthenticated,
      rate-limited, and can go down or change their TLS setup without notice
      — which is very likely what caused the ERR_CERT_AUTHORITY_INVALID you
      hit. Point PROXY_URL_TEMPLATE below at your own server-side proxy
      instead — a ready-to-deploy Supabase Edge Function is included at
      supabase/functions/dndbeyond-proxy/index.ts.
   3. Because this reads a real player's character data, only load
      characters your players are comfortable sharing this way, and treat
      this as a read-only preview, not a source of truth.
   ========================================================================== */

(function () {
  'use strict';

  // ---- Known campaign characters (from the D&D Beyond URLs you shared) ----
  // dndbeyond.com/characters/{id}/{shareToken} — the service only needs {id}.
  const KNOWN_CHARACTERS = [
    { id: '168724653', label: 'Lyon Nightshade' },
    { id: '168259462', label: 'Luna Liverta' },
    { id: '168259436', label: 'Syrena' },
    { id: '168222335', label: 'Khalen Moren' },
    { id: '168259911', label: 'Vigi Brunhilde' }
  ];

  // ------------------------------------------------------------------
  // Class theme — the sheet's whole visual identity (borders, headers,
  // buttons, the shimmer border, the avatar-ring glow) runs off the
  // --accent-gold family of CSS variables. Rather than hand-picking four
  // tints per class, each class here just gets ONE base color, tuned for
  // legibility on the parchment background and against white button
  // text; --accent-gold-light/-pale/-mid are derived from it at runtime
  // (see applyClassTheme below) the same way the original gold's tints
  // relate to its base (#B8922E → lighter/paler tints for shimmer/glow).
  // Colors echo the class icon colors used elsewhere in the app, nudged
  // where the original was too dark/desaturated to read well here.
  const CLASS_THEME_COLORS = {
    Barbarian: '#A8452C',
    Bard: '#8A57B0',
    Cleric: '#C9A227',
    Druid: '#5C8A4C',
    Fighter: '#5C7A99',
    Monk: '#C07A2E',
    Paladin: '#C0A052',
    Ranger: '#3C8562',
    Rogue: '#5A4B78',
    Sorcerer: '#B8433F',
    Warlock: '#7449A0',
    Wizard: '#3E6E9E'
  };
  const DEFAULT_THEME_COLOR = '#B8922E'; // original gold — no/unrecognized class

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 184, g: 146, b: 46 };
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s; const l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToHex({ h, s, l }) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Lighten a base hex color by `amt` (0–1, added to HSL lightness) and
  // optionally scale saturation, to build the light/pale/mid tints.
  function tint(hex, amt, satScale) {
    const hsl = rgbToHsl(hexToRgb(hex));
    hsl.l = Math.min(0.94, hsl.l + amt);
    if (satScale != null) hsl.s = Math.min(1, hsl.s * satScale);
    return hslToHex(hsl);
  }

  // Pick the character's primary class (highest level; ties broken by
  // whichever is flagged as the starting class) and apply its color as
  // the sheet's theme, deriving the shimmer/glow tints to match.
  let lastThemeClassName = ''; // remembered so callers can cache it post-render

  function themeColorForClassName(className) {
    return (className && CLASS_THEME_COLORS[className]) || DEFAULT_THEME_COLOR;
  }

  function applyThemeColor(base) {
    const rgb = hexToRgb(base);
    const root = document.documentElement.style;
    root.setProperty('--accent-gold', base);
    root.setProperty('--accent-gold-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.setProperty('--accent-gold-light', tint(base, 0.28, 0.9));
    root.setProperty('--accent-gold-pale', tint(base, 0.41, 0.7));
    root.setProperty('--accent-gold-mid', tint(base, 0.17, 0.95));
  }

  function applyClassTheme(data) {
    const classes = (data && data.classes) || [];
    let primary = null;
    classes.forEach(c => {
      if (!primary
        || (c.level || 0) > (primary.level || 0)
        || ((c.level || 0) === (primary.level || 0) && c.isStartingClass && !primary.isStartingClass)) {
        primary = c;
      }
    });
    const className = (primary && primary.definition && primary.definition.name) || '';
    lastThemeClassName = className;
    applyThemeColor(themeColorForClassName(className));
  }

  // ------------------------------------------------------------------
  // Know the character before the fetch even starts. index.html links
  // here with ?name=&class= for the character it knows you're opening;
  // we also remember the last name/class we saw per character id in
  // localStorage (updated once real data renders), so a bookmarked URL,
  // an F5, or a stale link still primes correctly. Only the live fetch
  // is authoritative — this is purely a best-guess so the loading splash
  // never opens gold/nameless and then jumps.
  // ------------------------------------------------------------------
  const KNOWN_META_PREFIX = 'dnd-sheet-known-meta:';

  function loadKnownMeta(id) {
    try {
      const raw = localStorage.getItem(KNOWN_META_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function saveKnownMeta(id, name, className) {
    try {
      localStorage.setItem(KNOWN_META_PREFIX + id, JSON.stringify({ name: name || '', className: className || '' }));
    } catch (err) {
      /* localStorage unavailable/full — the splash just falls back to gold/generic next time */
    }
  }

  function setLoaderCaption(name) {
    const loaderText = el('sheetLoaderText');
    if (loaderText) loaderText.textContent = name ? `Writing ${name}'s sheet…` : 'Writing character sheet…';
  }

  // Called synchronously before any fetch, straight off the URL params /
  // localStorage guess, so the splash opens already themed and named.
  function primeLoaderForCharacter(id) {
    const params = new URLSearchParams(location.search);
    let name = params.get('name') || '';
    let className = params.get('class') || '';
    if (!name && !className) {
      const known = loadKnownMeta(id);
      if (known) {
        name = known.name;
        className = known.className;
      }
    }
    if (className) applyThemeColor(themeColorForClassName(className));
    setLoaderCaption(name);
    if (name || className) saveKnownMeta(id, name, className);
  }

  // Wraps render(data) so the real, fetched name/class get written back
  // to the localStorage guess for next time.
  function renderAndRemember(id, data) {
    render(data);
    saveKnownMeta(id, data && data.name, lastThemeClassName);
  }

  // ------------------------------------------------------------------
  // Loading splash — covers the sheet (typewriter animation, tinted via
  // the class-theme CSS variables applyClassTheme() sets) until the
  // character data has rendered, so the page never shows its empty gold
  // shell. Enforces a minimum display time so the animation actually
  // reads as a "loading" beat even when the cache hit is instant, rather
  // than just flashing.
  // ------------------------------------------------------------------
  const LOADER_MIN_MS = 1300;

  function showLoader() {
    const loader = el('sheetLoader');
    if (!loader) return;
    loader.classList.remove('is-hidden');
    loader.setAttribute('aria-hidden', 'false');
  }

  function hideLoader() {
    const loader = el('sheetLoader');
    if (!loader) return;
    loader.classList.add('is-hidden');
    loader.setAttribute('aria-hidden', 'true');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Call once data has rendered; waits out whatever's left of
  // LOADER_MIN_MS since `startedAt`, then fades the splash away.
  async function settleLoader(startedAt) {
    const remaining = LOADER_MIN_MS - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
    hideLoader();
  }

  const DIRECT_URL_TEMPLATE = 'https://character-service.dndbeyond.com/character/v5/character/{id}';
  // Deploy the included Supabase Edge Function, then set this to:
  // 'https://<your-project-ref>.functions.supabase.co/dndbeyond-proxy?id={id}'
  const PROXY_URL_TEMPLATE = 'https://uwyvdwswiytjhpfvvztn.functions.supabase.co/dndbeyond-proxy?id={id}';

  // ------------------------------------------------------------------
  // Supabase cache — the raw D&D Beyond payload is saved here every time
  // it's fetched. Normal page loads (including F5) read from this table
  // instead of hitting D&D Beyond/the proxy, so the sheet appears
  // instantly and doesn't depend on corsproxy/the edge function being up.
  // Only the "Refresh from D&D Beyond" button re-fetches the live data
  // and re-saves it here.
  //
  // One-time setup — run this in the Supabase SQL editor:
  //
  //   create table if not exists dndbeyond_cache (
  //     character_id text primary key,
  //     label text,
  //     payload jsonb not null,
  //     updated_at timestamptz not null default now()
  //   );
  //   alter table dndbeyond_cache enable row level security;
  //   create policy "public read"  on dndbeyond_cache for select using (true);
  //   create policy "public write" on dndbeyond_cache for insert with check (true);
  //   create policy "public update" on dndbeyond_cache for update using (true);
  //
  // (Same permissive-anon-key pattern the rest of app.js already uses for
  // the `characters`/`npcs`/etc. tables.)
  // ------------------------------------------------------------------
  const SUPABASE_URL = 'https://uwyvdwswiytjhpfvvztn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_9u3Ywuu9a_1ntmL0Xj0tYw_lXelpmge';
  const CACHE_TABLE = 'dndbeyond_cache';
  const LAST_CHAR_KEY = 'dnd-sheet-last-character';

  // Guarded in case the CDN script didn't load (e.g. offline) — the sheet
  // still works standalone, it just can't read/write the cache.
  const sheetSb = (function () {
    try {
      if (typeof supabase === 'undefined') return null;
      return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (err) {
      console.warn('Supabase client unavailable — caching disabled.', err);
      return null;
    }
  })();

  async function loadCachedCharacter(id) {
    if (!sheetSb) return null;
    try {
      const { data: row, error } = await sheetSb
        .from(CACHE_TABLE)
        .select('payload, updated_at')
        .eq('character_id', id)
        .maybeSingle();
      if (error) throw error;
      return row || null;
    } catch (err) {
      console.warn('Reading cached character failed:', err);
      return null;
    }
  }

  async function saveCachedCharacter(id, label, payload) {
    if (!sheetSb) return;
    try {
      const { error } = await sheetSb
        .from(CACHE_TABLE)
        .upsert([{ character_id: id, label: label || null, payload, updated_at: new Date().toISOString() }], { onConflict: 'character_id' });
      if (error) throw error;
    } catch (err) {
      console.warn('Saving character to cache failed:', err);
    }
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  }

  const ABILITY_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const ABILITY_FULL = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

  const SKILLS = [
    { name: 'Acrobatics', ability: 1 },
    { name: 'Animal Handling', ability: 4 },
    { name: 'Arcana', ability: 3 },
    { name: 'Athletics', ability: 0 },
    { name: 'Deception', ability: 5 },
    { name: 'History', ability: 3 },
    { name: 'Insight', ability: 4 },
    { name: 'Intimidation', ability: 5 },
    { name: 'Investigation', ability: 3 },
    { name: 'Medicine', ability: 4 },
    { name: 'Nature', ability: 3 },
    { name: 'Perception', ability: 4 },
    { name: 'Performance', ability: 5 },
    { name: 'Persuasion', ability: 5 },
    { name: 'Religion', ability: 3 },
    { name: 'Sleight of Hand', ability: 1 },
    { name: 'Stealth', ability: 1 },
    { name: 'Survival', ability: 4 }
  ];

  const el = (id) => document.getElementById(id);
  const mod = (score) => Math.floor((score - 10) / 2);
  const signed = (n) => (n >= 0 ? '+' + n : String(n));

  // D&D Beyond's rules text embeds its own internal glossary-linking markup
  // on top of the HTML, e.g. "[rules]shape-shifting;shape-shift[/rules]" or
  // "[condition]Incapacitated[/condition]" — square-bracket tags (not real
  // HTML) that wrap a compendium reference. Left alone these show up as
  // literal "[rules]...[/rules]" junk in the middle of feature/spell text.
  // When the tag content has a ";" the parts are "lookup-key;display-text"
  // — the display text (last segment) is what actually reads correctly in
  // the sentence — so we keep only that and drop the tag/lookup-key.
  const stripCustomTags = (text) => String(text || '')
    .replace(/\[([a-z][a-z0-9]*)\](.*?)\[\/\1\]/gi, (_match, _tag, inner) => {
      const parts = String(inner).split(';');
      return parts[parts.length - 1].trim();
    });

  // Named HTML entities D&D Beyond's rich text uses beyond the handful of
  // basics (curly quotes, dashes, ellipsis) plus a catch-all for numeric
  // entities, so text like "&ldquo;Known Forms&rdquo;" renders as actual
  // quote marks instead of leaking the raw entity into the sheet.
  const NAMED_ENTITIES = {
    nbsp: ' ', amp: '&', quot: '"', apos: "'",
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
    mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
    lsaquo: '\u2039', rsaquo: '\u203A', deg: '\u00B0'
  };
  const decodeEntities = (text) => String(text || '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const cp = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isNaN(cp) ? whole : String.fromCodePoint(cp);
      }
      const key = code.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
    });

  const stripHtml = (html) => decodeEntities(
    stripCustomTags(String(html || ''))
      .replace(/<\/(p|li|div|br)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();

  // Same idea as stripHtml, but keeps paragraph/list breaks instead of
  // flattening everything to one line — used for the full-description
  // modal, where the extra structure actually helps readability.
  const htmlToParagraphs = (html) => decodeEntities(
    stripCustomTags(String(html || ''))
      .replace(/<li[^>]*>/gi, '\n\u2022 ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const escapeHtml = (s) => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Compendium description HTML sometimes embeds an actual <table> (e.g.
  // the Druid's "Beast Shapes" table). The old flat stripHtml/htmlToParagraphs
  // pass just deleted the <table>/<tr>/<td> tags along with everything else,
  // leaving every cell's text jammed together on one line with no separators
  // — e.g. "Beast Shapes Druid Level Known Forms Max CR Fly Speed 2 4 1/4 No
  // 4 6 1/2 No 8 8 1 Yes". This pulls any <table> out first and turns it into
  // real header/row data so it can be rendered as an actual table, and treats
  // the surrounding prose the normal way. Returns an ordered array of blocks:
  // {type:'text', text} and {type:'table', headers, rows}.
  function parseRichBody(html) {
    const raw = String(html || '');
    const blocks = [];
    let cursor = 0;
    const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let m;
    while ((m = tableRe.exec(raw))) {
      const beforeText = htmlToParagraphs(raw.slice(cursor, m.index));
      if (beforeText) blocks.push({ type: 'text', text: beforeText });

      const rows = [];
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm;
      while ((rm = rowRe.exec(m[1]))) {
        const cells = [];
        const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
        let cm;
        while ((cm = cellRe.exec(rm[1]))) cells.push(stripHtml(cm[1]));
        if (cells.length) rows.push(cells);
      }
      // First row is treated as the header — D&D Beyond's own compendium
      // tables are always laid out that way.
      if (rows.length) blocks.push({ type: 'table', headers: rows[0], rows: rows.slice(1) });

      cursor = tableRe.lastIndex;
    }
    const tailText = htmlToParagraphs(raw.slice(cursor));
    if (tailText) blocks.push({ type: 'text', text: tailText });

    return blocks;
  }

  // Lazily-created single modal used to show the full, untruncated
  // description of an action/spell row when its notes column is too long
  // to fit inline.
  function ensureDetailModalRoot() {
    let root = document.getElementById('sheetDetailModalRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'sheetDetailModalRoot';
      document.body.appendChild(root);
    }
    return root;
  }

  function closeDetailModal() {
    const root = document.getElementById('sheetDetailModalRoot');
    if (root) root.innerHTML = '';
  }

  function openDetailModal(detail) {
    if (!detail) return;
    const root = ensureDetailModalRoot();
    const chips = (detail.meta || []).filter(Boolean)
      .map((m) => `<span class="detail-modal-chip">${escapeHtml(m)}</span>`).join('');
    // detail.body is an array of blocks from parseRichBody() — text
    // paragraphs and, where the source had one, actual tables — but also
    // accept a plain string for any caller that hasn't been updated.
    const blocks = Array.isArray(detail.body)
      ? detail.body
      : (detail.body ? [{ type: 'text', text: detail.body }] : []);
    const bodyHtml = blocks.length
      ? blocks.map((b) => {
        if (b.type === 'table') {
          const headHtml = (b.headers || []).length
            ? `<thead><tr>${b.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
            : '';
          const rowsHtml = (b.rows || [])
            .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('');
          return `<div class="detail-modal-table-wrap"><table class="detail-modal-table">${headHtml}<tbody>${rowsHtml}</tbody></table></div>`;
        }
        return b.text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('');
      }).join('')
      : '<p>No description available.</p>';
    root.innerHTML = `<div class="detail-modal-backdrop">
      <div class="detail-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(detail.title)}">
        <button type="button" class="detail-modal-close" aria-label="Close">×</button>
        <h3 class="detail-modal-title">${escapeHtml(detail.title)}</h3>
        ${detail.tagline ? `<div class="detail-modal-tagline">${escapeHtml(detail.tagline)}</div>` : ''}
        <div class="detail-modal-chips">${chips}</div>
        <div class="detail-modal-body">${bodyHtml}</div>
      </div>
    </div>`;
    root.querySelector('.detail-modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('detail-modal-backdrop')) closeDetailModal();
    });
    root.querySelector('.detail-modal-close').addEventListener('click', closeDetailModal);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeDetailModal(); document.removeEventListener('keydown', onEsc); }
    });
  }

  // D&D Beyond encodes "when this can be used" as a numeric activationType
  // (nested under `activation`, not a flat string) — this is the main
  // reason Actions/Bonus Actions weren't showing up before: the code was
  // reading a field that doesn't exist on the real payload.
  const ACTIVATION_TYPE_NAMES = {
    1: 'Action', 2: 'No Action', 3: 'Bonus Action', 4: 'Reaction',
    5: 'Minute', 6: 'Hour', 7: 'Special', 8: 'Legendary Action'
  };
  const ACTIVATION_TYPE_CATEGORY = {
    1: 'action', 2: 'other', 3: 'bonus', 4: 'reaction',
    5: 'other', 6: 'other', 7: 'other', 8: 'other'
  };
  function activationInfo(a) {
    // Prefer the nested {activationType, activationTime} shape used by
    // actions/spells; fall back to a flat string if one is ever present.
    const act = a.activation || {};
    let typeId = act.activationType;
    if (typeId == null && typeof a.activationType === 'number') typeId = a.activationType;
    if (typeId == null && typeof a.activationType === 'string') {
      const label = a.activationType;
      const category = { Action: 'action', 'Bonus Action': 'bonus', Reaction: 'reaction' }[label] || 'other';
      return { label, category };
    }
    const label = ACTIVATION_TYPE_NAMES[typeId];
    const time = act.activationTime;
    return {
      label: label ? (time && time !== 1 ? `${time} ${label}${time > 1 && typeId >= 5 ? 's' : ''}` : label) : null,
      category: ACTIVATION_TYPE_CATEGORY[typeId] || 'other'
    };
  }

  const DAMAGE_TYPE_NAMES = {
    1: 'Bludgeoning', 2: 'Piercing', 3: 'Slashing', 4: 'Necrotic', 5: 'Acid',
    6: 'Cold', 7: 'Fire', 8: 'Force', 9: 'Lightning', 10: 'Poison',
    11: 'Psychic', 12: 'Radiant', 13: 'Thunder'
  };
  const SPELL_SCHOOL_NAMES = {
    1: 'Abjuration', 2: 'Conjuration', 3: 'Divination', 4: 'Enchantment',
    5: 'Evocation', 6: 'Illusion', 7: 'Necromancy', 8: 'Transmutation'
  };
  const SPELL_COMPONENT_LETTERS = { 1: 'V', 2: 'S', 3: 'M' };

  function diceString(dice) {
    if (!dice) return '';
    if (dice.diceString) return dice.diceString;
    if (dice.diceCount && dice.diceValue) {
      const mult = dice.diceMultiplier && dice.diceMultiplier > 1 ? `${dice.diceMultiplier}x` : '';
      return `${mult}${dice.diceCount}d${dice.diceValue}`;
    }
    if (dice.fixedValue != null) return String(dice.fixedValue);
    return '';
  }

  // Which ability powers spellcasting — used for spell attack bonus / save
  // DC, since individual spells on the sheet don't carry that number
  // themselves. Falls back to the strongest of INT/WIS/CHA if no class on
  // the sheet declares one (homebrew classes, oracle data gaps, etc).
  function spellcastingAbilityIndex(data, scores) {
    for (const c of (data.classes || [])) {
      const abilId = (c.definition && c.definition.spellCastingAbilityId) || c.spellCastingAbilityId;
      if (abilId) return abilId - 1;
    }
    if (scores) {
      return [3, 4, 5].sort((a, b) => mod(scores[b]) - mod(scores[a]))[0];
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Populate the character picker
  // ------------------------------------------------------------------
  function initPicker() {
    const select = el('charSelect');
    select.innerHTML = KNOWN_CHARACTERS
      .map((c) => `<option value="${c.id}">${c.label}</option>`)
      .join('');

    const lastId = localStorage.getItem(LAST_CHAR_KEY);
    if (lastId && KNOWN_CHARACTERS.some((c) => c.id === lastId)) select.value = lastId;

    el('loadBtn').addEventListener('click', () => {
      loadCharacter(select.value); // cache-first — no D&D Beyond hit
    });
    const refreshBtn = el('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshCharacter(select.value); // always re-fetches from D&D Beyond
      });
    }
  }

  function labelFor(id) {
    const known = KNOWN_CHARACTERS.find((c) => c.id === id);
    return known ? known.label : id;
  }

  // Normal path: read the last-saved copy out of Supabase. Nothing here
  // ever touches D&D Beyond or the proxy, so this works even if both are
  // down, and it's instant on every page load/F5.
  async function loadCharacter(id) {
    const status = el('loadStatus');
    status.classList.remove('is-error');
    status.textContent = 'Loading saved sheet…';
    localStorage.setItem(LAST_CHAR_KEY, id);
    showLoader();
    primeLoaderForCharacter(id);
    const startedAt = Date.now();

    const cached = await loadCachedCharacter(id);
    if (cached && cached.payload) {
      const data = cached.payload.data ? cached.payload.data : cached.payload;
      renderAndRemember(id, data);
      status.textContent = `Loaded from saved data — synced ${relativeTime(cached.updated_at)}.`;
      await settleLoader(startedAt);
      return;
    }

    // Nothing cached yet for this character (first time ever) — fall back
    // to a live fetch so the sheet isn't just blank, then save it.
    status.textContent = 'No saved data yet — fetching from D&D Beyond…';
    await refreshCharacter(id, startedAt);
  }

  // Explicit path: hit D&D Beyond live (via the proxy), render it, and
  // save the result to Supabase so every future Load/F5 is instant again.
  // `startedAt`, if passed, is an in-progress loader's start time (from
  // loadCharacter's cache-miss fallback) — otherwise this owns the
  // loader itself (e.g. the manual "Resync" button).
  async function refreshCharacter(id, startedAt) {
    const status = el('loadStatus');
    status.classList.remove('is-error');
    status.textContent = 'Syncing with D&D Beyond…';
    localStorage.setItem(LAST_CHAR_KEY, id);
    const ownsLoader = startedAt == null;
    if (ownsLoader) {
      showLoader();
      primeLoaderForCharacter(id);
      startedAt = Date.now();
    }

    try {
      const payload = await fetchCharacterData(id);
      // The service wraps the character object in { success, data }.
      const data = payload && payload.data ? payload.data : payload;
      renderAndRemember(id, data);
      await saveCachedCharacter(id, labelFor(id), payload);
      status.textContent = 'Synced and saved — up to date.';
    } catch (err) {
      console.error(err);
      status.classList.add('is-error');
      status.textContent = 'Could not reach D&D Beyond — showing last saved data (likely CORS/proxy issue or a private character).';
      // Fall back to whatever's cached rather than leaving the sheet blank.
      const cached = await loadCachedCharacter(id);
      if (cached && cached.payload) {
        const data = cached.payload.data ? cached.payload.data : cached.payload;
        renderAndRemember(id, data);
      }
    } finally {
      await settleLoader(startedAt);
    }
  }

  async function fetchCharacterData(id) {
    const url = DIRECT_URL_TEMPLATE.replace('{id}', id);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (directErr) {
      if (!PROXY_URL_TEMPLATE || PROXY_URL_TEMPLATE.includes('<your-project-ref>')) {
        console.warn(
          'Direct fetch failed (expected — see the comment block at the top of this file). ' +
          'Set PROXY_URL_TEMPLATE to your deployed Supabase Edge Function URL to fix this.'
        );
        throw directErr;
      }
      const proxied = PROXY_URL_TEMPLATE.replace('{id}', id);
      const res = await fetch(proxied);
      if (!res.ok) throw new Error('Proxy HTTP ' + res.status);
      return await res.json();
    }
  }

  // ------------------------------------------------------------------
  // Core stat computation
  // ------------------------------------------------------------------

  // Sum every additive modifier of a given type/subType across all
  // modifier groups (race, class, background, item, feat, condition).
  function sumModifiers(data, type, subType, opts) {
    opts = opts || {};
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    let total = 0;
    groups.forEach((list) => {
      (list || []).forEach((m) => {
        if (m.type !== type) return;
        if (subType && m.subType !== subType) return;
        if (opts.entityId != null && m.entityId !== opts.entityId) return;
        if (m.isGranted === false) return;
        total += m.value || 0;
      });
    });
    return total;
  }

  function abilityScore(data, index) {
    if (!data) return 10;
    // index: 0-5 matching STR..CHA, D&D Beyond stat ids are 1-6.
    const statId = index + 1;
    const fullName = (ABILITY_FULL[index] || '').toLowerCase(); // e.g. 'dexterity'
    const scoreKey = fullName + '-score'; // e.g. 'dexterity-score'

    // 1. Explicit override (e.g. overrideStats array)
    const overrideObj = (data.overrideStats || []).find((s) => s && s.id === statId);
    if (overrideObj && typeof overrideObj.value === 'number' && overrideObj.value > 0) {
      return overrideObj.value;
    }

    // 2. Base score (data.stats) & user manual bonus (data.bonusStats)
    const baseObj = (data.stats || []).find((s) => s && s.id === statId) || {};
    const base = baseObj.value != null ? baseObj.value : 10;

    const bonusObj = (data.bonusStats || []).find((s) => s && s.id === statId) || {};
    const bonus = bonusObj.value != null ? bonusObj.value : 0;

    let modBonus = 0;
    let setStatValue = null;
    let characterValueOverride = null;

    const getModValue = (m) => {
      if (typeof m.value === 'number' && m.value !== 0) return m.value;
      if (typeof m.fixedValue === 'number' && m.fixedValue !== 0) return m.fixedValue;
      return 1;
    };

    const isTargetStat = (m) => {
      if (!m) return false;
      if (m.type !== 'bonus' && m.type !== 'set') return false;
      if (m.statId === statId) return true;
      const sub = (m.subType || '').toLowerCase();
      const friendly = (m.friendlySubtypeName || '').toLowerCase();
      if (sub === scoreKey || sub === fullName) return true;
      if (friendly === scoreKey.replace('-', ' ') || friendly === fullName) return true;
      return false;
    };

    // 3. Process data.modifiers across all groups (race, class, background, item, feat, condition)
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    groups.forEach((list) => {
      (list || []).forEach((m) => {
        if (!m || m.isGranted === false) return;
        if (isTargetStat(m)) {
          const val = getModValue(m);
          if (m.type === 'bonus') {
            modBonus += val;
          } else if (m.type === 'set') {
            if (setStatValue == null || val > setStatValue) {
              setStatValue = val;
            }
          }
        }
      });
    });

    // 4. Process choices in data.choices (e.g. Half-Elf / Custom Lineage / ASI choice selections)
    const optionMap = {};
    const indexOptions = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.id && obj.label && typeof obj.label === 'string') {
        optionMap[obj.id] = obj.label;
      }
      Object.values(obj).forEach((v) => {
        if (v && typeof v === 'object') indexOptions(v);
      });
    };
    indexOptions(data);

    const choicesObj = data.choices || {};
    Object.values(choicesObj).forEach((choiceList) => {
      if (!Array.isArray(choiceList)) return;
      choiceList.forEach((choice) => {
        if (!choice || !choice.optionValue) return;
        const choiceLabel = (choice.label || '').toLowerCase();
        // Check if choice is an ability score choice
        if (choiceLabel.includes('ability score') || choice.subType === 5 || choice.type === 2) {
          const optLabel = optionMap[choice.optionValue];
          if (optLabel) {
            const l = optLabel.toLowerCase();
            if (l === fullName || l === scoreKey.replace('-', ' ') || l.startsWith(fullName)) {
              modBonus += 1;
            }
          }
        }
      });
    });

    // 5. Process data.characterValues (user manual sheet overrides or direct choice values)
    const charValues = data.characterValues || [];
    charValues.forEach((cv) => {
      if (!cv) return;
      if (cv.typeId === statId && typeof cv.value === 'number' && cv.value > 0) {
        characterValueOverride = cv.value;
      }
    });

    if (characterValueOverride != null) {
      return characterValueOverride;
    }

    let total = base + bonus + modBonus;
    if (setStatValue != null) {
      total = Math.max(total, setStatValue);
    }
    return total;
  }

  function totalLevel(data) {
    return (data.classes || []).reduce((sum, c) => sum + (c.level || 0), 0);
  }

  function proficiencyBonus(level) {
    return Math.ceil(level / 4) + 1;
  }

  function isSkillProficient(data, skillName) {
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    let expertise = false, proficient = false;
    groups.forEach((list) => {
      (list || []).forEach((m) => {
        const sub = (m.subType || '').replace(/-/g, ' ');
        if (sub.toLowerCase() !== skillName.toLowerCase()) return;
        if (m.type === 'expertise') expertise = true;
        if (m.type === 'proficiency') proficient = true;
      });
    });
    return { proficient, expertise };
  }

  function isSaveProficient(data, abilityIndex) {
    const key = ABILITY_FULL[abilityIndex].toLowerCase() + '-saving-throws';
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    return groups.some((list) => (list || []).some((m) => m.type === 'proficiency' && m.subType === key));
  }

  function armorClass(data, scores) {
    if (typeof data.overrideArmorClass === 'number') return data.overrideArmorClass;
    const dexMod = mod(scores[1]);
    const equippedArmor = (data.inventory || []).find(
      (i) => i.equipped && i.definition && i.definition.filterType === 'Armor'
    );
    let base = 10 + dexMod;
    if (equippedArmor && equippedArmor.definition.armorClass != null) {
      base = equippedArmor.definition.armorClass;
      if (equippedArmor.definition.armorTypeId === 1) base = equippedArmor.definition.armorClass; // light: full dex, already base
    }
    base += sumModifiers(data, 'bonus', 'armor-class');
    return base;
  }

  // D&D Beyond's `baseHitPoints` is just the raw hit-die total (fixed
  // values or actual rolls) — it does NOT include the Constitution bonus
  // per level, which the real character sheet adds in separately client
  // -side. This was being skipped entirely here (armorClass already adds
  // its DEX equivalent, hitPoints never added its CON one), which is why
  // any character with a positive CON modifier read several HP low — a
  // 4th-level character with a +2 CON mod, for example, was short by 8.
  function hitPoints(data, scores) {
    if (typeof data.overrideHitPoints === 'number') {
      const max = data.overrideHitPoints;
      const removed = data.removedHitPoints || 0;
      return { max, current: Math.max(0, max - removed), temp: data.temporaryHitPoints || 0 };
    }
    const base = data.baseHitPoints || 0;
    const level = totalLevel(data);
    const conBonus = mod(scores[2]) * level;
    const bonusPerLevel = sumModifiers(data, 'bonus', 'hit-points-per-level') * level;
    const flatBonus = sumModifiers(data, 'bonus', 'hit-points');
    const max = base + conBonus + bonusPerLevel + flatBonus + (data.bonusHitPoints || 0);
    const removed = data.removedHitPoints || 0;
    return {
      max,
      current: Math.max(0, max - removed),
      temp: data.temporaryHitPoints || 0
    };
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  let lastCharacterData = null; // used by the rest buttons (e.g. Warlock check)

  function render(data) {
    if (!data) return;
    lastCharacterData = data;
    applyClassTheme(data);
    setLoaderCaption(data.name);
    renderHeader(data);
    const scores = ABILITY_NAMES.map((_, i) => abilityScore(data, i));
    const level = totalLevel(data);
    const prof = proficiencyBonus(level);
    renderAbilityBoxes(scores, prof, data);
    renderTopChips(data, scores, prof, level);
    renderSaves(data, scores, prof);
    renderPassives(data, scores, prof);
    renderProficiencyText(data);
    renderSkills(data, scores, prof);
    renderDefenses(data);
    renderActions(data, scores, prof);
    renderSpells(data, scores, prof);
    renderInventory(data);

    renderFeatures(data);
    renderBackground(data);
    renderNotes(data);
    renderExtras(data);
  }

  function renderHeader(data) {
    el('csName').textContent = data.name || 'Unnamed';
    el('csRace').textContent = (data.race && data.race.fullName) || (data.race && data.race.baseName) || '—';
    el('csClasses').textContent = (data.classes || [])
      .map((c) => `${(c.definition && c.definition.name) || 'Class'}${c.subclassDefinition ? ' (' + c.subclassDefinition.name + ')' : ''} ${c.level}`)
      .join(' / ') || '—';
    el('csLevel').textContent = totalLevel(data) || '—';
    el('csCampaign').textContent = (data.campaign && data.campaign.name) ? data.campaign.name : 'No active campaign';

    const avatarUrl = data.decorations && data.decorations.avatarUrl;
    const avatarImg = el('csAvatar');
    const fallback = el('csAvatarFallback');
    if (avatarUrl) {
      avatarImg.src = avatarUrl;
      avatarImg.hidden = false;
      fallback.hidden = true;
    } else {
      avatarImg.hidden = true;
      fallback.hidden = false;
      fallback.textContent = (data.name || '?').charAt(0).toUpperCase();
    }
  }

  function renderAbilityBoxes(scores, prof, data) {
    const wrap = el('abilityBoxes');
    wrap.innerHTML = ABILITY_NAMES.map((name, i) => {
      const score = scores[i];
      const m = mod(score);
      return `<div class="ability-box">
        <div class="ab-name">${name}</div>
        <div class="ab-mod">${signed(m)}</div>
        <div class="ab-score">${score}</div>
      </div>`;
    }).join('');
  }

  function renderTopChips(data, scores, prof, level) {
    el('valProf').textContent = signed(prof);
    el('valSpeed').textContent = (data.race && data.race.weightSpeeds && data.race.weightSpeeds.normal && data.race.weightSpeeds.normal.walk) ?
      data.race.weightSpeeds.normal.walk + ' ft' : '30 ft';
    const inspirationChip = el('chipInspiration');
    const inspirationVal = el('valInspiration');
    inspirationVal.textContent = data.inspiration ? '●' : '○';
    if (inspirationChip) {
      inspirationChip.classList.toggle('insp-active', !!data.inspiration);
      inspirationChip.setAttribute('aria-pressed', data.inspiration ? 'true' : 'false');
      inspirationChip.onclick = () => {
        data.inspiration = !data.inspiration;
        inspirationVal.textContent = data.inspiration ? '●' : '○';
        inspirationChip.classList.toggle('insp-active', !!data.inspiration);
        inspirationChip.setAttribute('aria-pressed', data.inspiration ? 'true' : 'false');
      };
      inspirationChip.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inspirationChip.click();
        }
      };
    }
    el('valInit').textContent = signed(mod(scores[1]) + sumModifiers(data, 'bonus', 'initiative'));
    el('valAC').textContent = armorClass(data, scores);

    const hp = hitPoints(data, scores);
    const curInput = el('valHPCurrent');
    const maxInput = el('valHPMax');
    const tempInput = el('valHPTemp');
    curInput.value = hp.current;
    maxInput.value = hp.max;
    tempInput.value = hp.temp;

    // HP is fully editable by hand (damage taken, healing, temp HP) —
    // just keep whatever's typed sane (no blanks, no negatives).
    const clampOnInput = (input) => {
      input.oninput = () => {
        if (input.value === '') { updateHPFillBar(); return; } // let them clear it mid-edit
        let v = parseInt(input.value, 10);
        if (isNaN(v) || v < 0) v = 0;
        if (String(v) !== input.value) input.value = v;
        updateHPFillBar();
      };
      input.onblur = () => {
        if (input.value === '' || isNaN(parseInt(input.value, 10))) input.value = 0;
        updateHPFillBar();
      };
    };
    clampOnInput(curInput);
    clampOnInput(maxInput);
    clampOnInput(tempInput);
    updateHPFillBar();
  }

  // ------------------------------------------------------------------
  // HP fill bar — same look as the campaign manager's character-detail
  // HP bar: a liquid, color-coded fill (good/low/critical) that glides
  // to its new width whenever current/max HP changes.
  // ------------------------------------------------------------------
  function updateHPFillBar() {
    const fill = el('hpFillBar');
    if (!fill) return;
    const cur = parseInt(el('valHPCurrent').value, 10) || 0;
    const max = parseInt(el('valHPMax').value, 10) || 0;
    const pct = max ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    fill.style.width = pct + '%';
    fill.classList.toggle('critical', max > 0 && pct <= 25);
    fill.classList.toggle('low', max > 0 && pct > 25 && pct <= 50);
  }

  function renderSaves(data, scores, prof) {
    const list = el('saveList');
    list.innerHTML = ABILITY_NAMES.map((name, i) => {
      const proficient = isSaveProficient(data, i);
      const bonus = mod(scores[i]) + (proficient ? prof : 0) + sumModifiers(data, 'bonus', ABILITY_FULL[i].toLowerCase() + '-saving-throws');
      return `<li>
        <span class="prof-dot ${proficient ? 'is-proficient' : ''}"></span>
        <span>${name}</span>
        <span class="skill-attr"></span>
        <span class="stat-bonus">${signed(bonus)}</span>
      </li>`;
    }).join('');
  }

  function renderPassives(data, scores, prof) {
    const perc = isSkillProficient(data, 'perception');
    const inv = isSkillProficient(data, 'investigation');
    const ins = isSkillProficient(data, 'insight');
    el('passivePerception').textContent = 10 + mod(scores[4]) + (perc.expertise ? prof * 2 : perc.proficient ? prof : 0);
    el('passiveInvestigation').textContent = 10 + mod(scores[3]) + (inv.expertise ? prof * 2 : inv.proficient ? prof : 0);
    el('passiveInsight').textContent = 10 + mod(scores[4]) + (ins.expertise ? prof * 2 : ins.proficient ? prof : 0);
  }

  function renderProficiencyText(data) {
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    const collect = (type, filterFn) => {
      const seen = new Set();
      groups.forEach((list) => (list || []).forEach((m) => {
        if (m.type !== type) return;
        if (filterFn && !filterFn(m)) return;
        if (m.friendlySubtypeName) seen.add(m.friendlySubtypeName);
      }));
      return Array.from(seen);
    };
    const armor = collect('proficiency', (m) => /armor|shield/i.test(m.friendlySubtypeName || ''));
    const weapons = collect('proficiency', (m) => /weapon/i.test(m.friendlySubtypeName || ''));
    const tools = collect('proficiency', (m) => /tool|kit|instrument|gaming set/i.test(m.friendlySubtypeName || ''));
    const languages = collect('language');

    el('profArmor').textContent = armor.length ? armor.join(', ') : '—';
    el('profWeapons').textContent = weapons.length ? weapons.join(', ') : '—';
    el('profTools').textContent = tools.length ? tools.join(', ') : '—';
    el('profLanguages').textContent = languages.length ? languages.join(', ') : '—';
  }

  function renderSkills(data, scores, prof) {
    const list = el('skillList');
    list.innerHTML = SKILLS.map((s) => {
      const { proficient, expertise } = isSkillProficient(data, s.name);
      const bonus = mod(scores[s.ability]) + (expertise ? prof * 2 : proficient ? prof : 0) +
        sumModifiers(data, 'bonus', s.name.toLowerCase().replace(/\s+/g, '-'));
      return `<li>
        <span class="prof-dot ${expertise ? 'is-expert' : proficient ? 'is-proficient' : ''}"></span>
        <span>${s.name}</span>
        <span class="skill-attr">${ABILITY_NAMES[s.ability]}</span>
        <span class="stat-bonus">${signed(bonus)}</span>
      </li>`;
    }).join('');
  }

  function renderDefenses(data) {
    const groups = (data.modifiers && Object.values(data.modifiers)) || [];
    const collectDamage = (type) => {
      const seen = new Set();
      groups.forEach((list) => (list || []).forEach((m) => {
        if (m.type !== type) return;
        if (m.friendlySubtypeName) seen.add(m.friendlySubtypeName);
      }));
      return Array.from(seen);
    };
    const resist = collectDamage('resistance');
    const immune = collectDamage('immunity');
    const vuln = collectDamage('vulnerability');
    el('defResist').textContent = resist.length ? resist.join(', ') : '—';
    el('defImmune').textContent = immune.length ? immune.join(', ') : '—';
    el('defVuln').textContent = vuln.length ? vuln.join(', ') : '—';
    const conditions = (data.conditions || []).map((c) => c.name || c).filter(Boolean);
    el('defConditions').textContent = conditions.length ? conditions.join(', ') : 'None';
  }

  // Pull real damage dice + type out of a spell/action, preferring
  // structured fields when the payload has them and falling back to
  // reading the dice notation straight out of the description text
  // (D&D Beyond's spell definitions don't reliably expose damage as a
  // clean structured field the way weapons do).
  function extractDamage(def, text) {
    const mods = def && def.modifiers;
    if (Array.isArray(mods)) {
      const dmgMod = mods.find((m) => m.type === 'damage' && (m.die || m.dice));
      if (dmgMod) {
        const die = diceString(dmgMod.die || dmgMod.dice);
        if (die) return `${die} ${dmgMod.subType || ''}`.trim();
      }
    }
    if (text) {
      const m = text.match(/(\d{1,2}d\d{1,3}(?:\s*\+\s*\d+)?)\s*(?:\([^)]*\)\s*)?([a-z]+)?\s*damage/i);
      if (m) {
        const type = (m[2] || '').toLowerCase();
        const validType = Object.values(DAMAGE_TYPE_NAMES).some((t) => t.toLowerCase() === type);
        return `${m[1]}${validType ? ' ' + m[2][0].toUpperCase() + m[2].slice(1) : ''}`.trim();
      }
    }
    return '';
  }

  // Best-effort DC pulled from description text when there's no
  // structured field to compute it from (plain class/race actions).
  function extractDcFromText(text) {
    if (!text) return null;
    const m = text.match(/DC\s*(\d{1,2})/i);
    return m ? `DC ${m[1]}` : null;
  }

  function ordinal(n) {
    n = Number(n);
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // D&D Beyond's real field is atHigherLevels.higherLevelDefinitions (an
  // array of { level, typeId, dice, value, details }) — NOT
  // "higherLevelDetails"/"levelMap"/"details", which is what this used to
  // look for, so it always came back empty and no scaling ever showed.
  // On top of that, the scaling data isn't always on the spell definition
  // itself — for damage spells it's frequently attached to the individual
  // damage MODIFIER instead (the same object extractDamage() reads the
  // base dice from), so we check both and merge whatever has entries.
  //
  // The "level" on each entry means different things depending on the
  // spell's scaleType:
  //  - cantrips ("characterlevel"): `level` is the absolute character
  //    level the tier kicks in at (5, 11, 17) and `dice` is that tier's
  //    full damage.
  //  - leveled spells ("spellscale"): `level` is an OFFSET above the
  //    spell's own book level (almost always 1, meaning "starting one
  //    slot level above base") and `dice` is the amount added for EACH
  //    slot level from that point on — e.g. Chromatic Orb (1st level)
  //    adds 1d8 for every level above 1st, not a flat 1d8 total.
  // Returns null, or { isCantrip, baseLevel, rates: [{fromLevel, count, sides}] }.
  function higherLevelRates(def) {
    const baseLevel = def.level != null ? def.level : 0;
    const isCantrip = baseLevel === 0;

    const sources = [];
    if (def.atHigherLevels) sources.push(def.atHigherLevels);
    const mods = Array.isArray(def.modifiers) ? def.modifiers : [];
    const dmgMod = mods.find((m) => m.type === 'damage' && (m.die || m.dice));
    if (dmgMod && dmgMod.atHigherLevels) sources.push(dmgMod.atHigherLevels);

    const rates = [];
    sources.forEach((atHL) => {
      const arr = atHL.higherLevelDefinitions;
      if (!Array.isArray(arr)) return;
      arr.forEach((entry) => {
        if (!entry || !entry.dice) return; // non-damage entries (e.g. extra targets/creatures) carry no dice
        const count = entry.dice.diceCount;
        const sides = entry.dice.diceValue;
        if (!count || !sides) return;
        const fromLevel = isCantrip ? entry.level : baseLevel + (entry.level || 1);
        if (fromLevel == null) return;
        rates.push({ fromLevel, count, sides });
      });
    });
    if (!rates.length) return null;
    rates.sort((a, b) => a.fromLevel - b.fromLevel);
    return { isCantrip, baseLevel, rates };
  }

  // How much extra/total damage applies at a given target level.
  // Cantrips: the matching tier REPLACES the base damage entirely.
  // Leveled spells: each rate's bonus dice stack once per level from its
  // starting level up through the target level (uniform per-slot scaling).
  function scalingAtLevel(scaling, targetLevel) {
    if (!scaling) return null;
    if (scaling.isCantrip) {
      let best = null;
      scaling.rates.forEach((r) => { if (r.fromLevel <= targetLevel && (!best || r.fromLevel > best.fromLevel)) best = r; });
      return best ? { count: best.count, sides: best.sides, replace: true } : null;
    }
    let addCount = 0, sides = null;
    scaling.rates.forEach((r) => {
      if (targetLevel >= r.fromLevel) {
        addCount += r.count * (targetLevel - r.fromLevel + 1);
        sides = sides || r.sides;
      }
    });
    return addCount ? { count: addCount, sides, replace: false } : null;
  }

  // Applies a scaling result on top of a base "3d8 Fire"-style damage
  // string. Falls back to leaving the base string untouched if it can't
  // safely parse dice out of it.
  function applyScaling(baseDmg, scaling) {
    if (!scaling) return baseDmg;
    const m = String(baseDmg || '').match(/^(\d+)d(\d+)(?:\s*\+\s*\d+)?\s*([A-Za-z]*)/);
    const typeWord = m ? m[3] : '';
    if (scaling.replace) {
      return `${scaling.count}d${scaling.sides}${typeWord ? ' ' + typeWord : ''}`.trim();
    }
    if (!m) return baseDmg; // couldn't parse a base die count to add onto
    const baseCount = Number(m[1]);
    const baseSides = Number(m[2]);
    const sides = scaling.sides || baseSides;
    if (sides !== baseSides) return baseDmg; // mismatched die type, don't guess
    return `${baseCount + scaling.count}d${sides}${typeWord ? ' ' + typeWord : ''}`.trim();
  }

  function formatScaling(def, scaling) {
    if (scaling.isCantrip) {
      return scaling.rates.map((r) => `CL${r.fromLevel} ${r.count}d${r.sides}`).join(' · ');
    }
    // Leveled spells scale uniformly per slot level rather than at fixed
    // breakpoints, so describe the rate instead of listing every level.
    return scaling.rates.map((r) => `+${r.count}d${r.sides} per slot level above ${ordinal(r.fromLevel - 1)}`).join(', ');
  }

  const RESET_TYPE_NAMES = { 1: 'short rest', 2: 'long rest', 3: 'dawn' };

  // "Circle Spell" (2024 rules glossary group-casting mechanic — Augment /
  // Distribute / Expand / Prolong / Safeguard / Supplant / "Initiate a
  // Circle Spell") isn't used at all in these campaigns, but D&D Beyond
  // still hands it back as a normal action entry for any caster who
  // qualifies, so it needs to be filtered out wherever it can show up
  // (actions, class features, feats) rather than assumed to live in one
  // specific spot.
  const isCircleSpellEntry = (name) => /circle spell/i.test(name || '');

  function collectActions(data) {
    const groups = (data.actions && Object.values(data.actions)) || [];
    const flat = [];
    groups.forEach((list) => (list || []).forEach((a) => {
      if (a && !isCircleSpellEntry(a.name)) flat.push(a);
    }));

    // Weapon attacks live in inventory (equipped weapons), not `actions`.
    (data.inventory || []).forEach((item) => {
      if (item.equipped && item.definition &&
        (item.definition.filterType === 'Weapon' || item.definition.type === 'Weapon')) {
        flat.push({
          name: item.definition.name,
          isWeapon: true,
          weaponDef: item.definition,
          limitedUse: null
        });
      }
    });
    return flat;
  }

  // Innate/always-on spells (race, class, background, item, feat) plus
  // each class's known/prepared spell list. The original code never read
  // `data.spells` or `data.classSpells` at all, which is why nothing in
  // the spellbook ever showed up.
  //
  // Circle (druid subclass) spells are always excluded — see the detailed
  // comment inside the function for how.
  function collectSpells(data, opts) {
    opts = opts || {};
    const flat = [];

    // Circle spells (Circle of the Land / Moon / Stars / Wildfire / Spores /
    // Dreams / etc. — any Druid "Circle of ..." subclass) are excluded
    // unconditionally; this sheet's campaigns never use them. Matching is
    // deliberately layered/defensive since the exact payload shape a given
    // spell entry carries isn't fully predictable:
    //  1. componentId pointing at a "Circle of ..." class feature.
    //  2. componentId pointing at ANY feature belonging to a subclass whose
    //     own name starts with "Circle of" (catches feature names that
    //     don't literally say "Circle of", e.g. a generic "Circle Spells").
    //  3. A generic scan of the spell entry's own string fields (excluding
    //     its actual spell name, so a real spell like "Magic Circle" or
    //     "Circle of Death" is never mistakenly caught) for the word
    //     "circle" — catches sourceName/componentName/subclassName-style
    //     fields under whatever key the live payload actually uses.
    const circleFeatureIds = new Set();
    const circleSubclassFeatureIds = new Set();
    (data.classes || []).forEach(c => {
      const subclassName = (c.subclassDefinition && c.subclassDefinition.name) || '';
      const isCircleSubclass = /circle of/i.test(subclassName);
      (c.classFeatures || []).forEach(cf => {
        const def = cf.definition || {};
        const name = def.name || '';
        if (def.id == null) return;
        if (/circle of/i.test(name)) circleFeatureIds.add(def.id);
        if (isCircleSubclass && (def.subclassId != null || /circle/i.test(name))) {
          circleSubclassFeatureIds.add(def.id);
        }
      });
    });

    const scanForCircle = (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      return Object.keys(obj).some((k) => {
        if (k === 'name') return false; // never match on the spell's own name
        const v = obj[k];
        return typeof v === 'string' && /circle/i.test(v);
      });
    };

    const isCircleSpell = s => {
      if (!s) return false;
      if (s.componentId != null && (circleFeatureIds.has(s.componentId) || circleSubclassFeatureIds.has(s.componentId))) return true;
      return scanForCircle(s) || scanForCircle(s.definition);
    };

    const alwaysGroups = (data.spells && Object.values(data.spells)) || [];
    alwaysGroups.forEach(list => (list || []).forEach(s => {
      if (s && !isCircleSpell(s)) flat.push(s);
    }));

    (data.classSpells || []).forEach(cs => {
      const className = (cs.characterClassId &&
        (data.classes || []).find(c => c.id === cs.characterClassId || c.definition && c.definition.id === cs.characterClassId))
        ? ((data.classes.find(c => c.id === cs.characterClassId || (c.definition && c.definition.id === cs.characterClassId)) || {}).definition || {}).name || ''
        : '';
      (cs.spells || []).forEach(s => {
        if (!s || isCircleSpell(s)) return;
        // Tag with class name for the Spells tab source column
        if (className) s._className = className;
        flat.push(s);
      });
    });
    return flat;
  }


  // The same spell can legitimately show up in more than one place in the
  // payload — e.g. once as an "always prepared" class/subclass spell and
  // again in that class's chosen spell list — and those two copies don't
  // always agree on `definition.level` (one has been seen carrying the
  // slot level it was last cast at rather than the spell's own book
  // level). Keep one copy per spell name and prefer whichever copy has
  // the LOWER level, since a spell's true level is fixed and can only be
  // reported too high, never too low.
  function dedupeSpells(spells) {
    const byName = new Map();
    const noName = [];
    spells.forEach((s) => {
      const def = s.definition || {};
      const key = (def.name || '').trim().toLowerCase();
      if (!key) { noName.push(s); return; }
      const existing = byName.get(key);
      const thisLevel = def.level != null ? def.level : 99;
      const existingLevel = existing ? (existing.definition && existing.definition.level != null ? existing.definition.level : 99) : Infinity;
      if (!existing || thisLevel < existingLevel) byName.set(key, s);
    });
    return [...byName.values(), ...noName];
  }

  // Standard 5e multiclass spellslot table: combined caster level -> slots
  // per spell level 1-9. (Also the single-class full-caster progression —
  // Wizard/Cleric/Druid/Bard/Sorcerer use this directly.)
  const MULTICLASS_SLOT_TABLE = {
    1: [2, 0, 0, 0, 0, 0, 0, 0, 0], 2: [3, 0, 0, 0, 0, 0, 0, 0, 0], 3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    4: [4, 3, 0, 0, 0, 0, 0, 0, 0], 5: [4, 3, 2, 0, 0, 0, 0, 0, 0], 6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 3, 1, 0, 0, 0, 0, 0], 8: [4, 3, 3, 2, 0, 0, 0, 0, 0], 9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [4, 3, 3, 3, 2, 0, 0, 0, 0], 11: [4, 3, 3, 3, 2, 1, 0, 0, 0], 12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [4, 3, 3, 3, 2, 1, 1, 0, 0], 14: [4, 3, 3, 3, 2, 1, 1, 0, 0], 15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [4, 3, 3, 3, 2, 1, 1, 1, 0], 17: [4, 3, 3, 3, 2, 1, 1, 1, 1], 18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1]
  };
  // Warlock Pact Magic is a separate slot pool: level -> {slots, level}.
  const PACT_MAGIC_TABLE = {
    1: { slots: 1, level: 1 }, 2: { slots: 2, level: 1 }, 3: { slots: 2, level: 2 }, 4: { slots: 2, level: 2 },
    5: { slots: 2, level: 3 }, 6: { slots: 2, level: 3 }, 7: { slots: 2, level: 4 }, 8: { slots: 2, level: 4 },
    9: { slots: 2, level: 5 }, 10: { slots: 2, level: 5 }, 11: { slots: 3, level: 5 }, 12: { slots: 3, level: 5 },
    13: { slots: 3, level: 5 }, 14: { slots: 3, level: 5 }, 15: { slots: 3, level: 5 }, 16: { slots: 3, level: 5 },
    17: { slots: 4, level: 5 }, 18: { slots: 4, level: 5 }, 19: { slots: 4, level: 5 }, 20: { slots: 4, level: 5 }
  };
  const FULL_CASTER_CLASSES = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard']);
  const HALF_CASTER_CLASSES = new Set(['paladin', 'ranger']);
  const THIRD_CASTER_SUBCLASSES = new Set(['eldritch knight', 'arcane trickster']);

  // The unofficial payload only tells you *used* slots (data.spellSlots),
  // not the max — D&D Beyond computes that client-side from the class
  // spellcasting tables, so we do the same here. If the payload ever does
  // carry an explicit max/available number for a level, that wins instead.
  // hasLeveledSpells is a last-resort signal: if the character clearly has
  // real (non-cantrip) spells but none of our class-name matching found a
  // recognized caster (e.g. an unfamiliar homebrew/variant class name),
  // fall back to treating total level as a full caster rather than
  // showing zero slots everywhere.
  function computeMaxSpellSlots(data, hasLeveledSpells) {
    const map = {};
    let casterLevel = 0;
    let matchedAnyCaster = false;
    (data.classes || []).forEach((c) => {
      const def = c.definition || {};
      const name = (def.name || '').toLowerCase().trim();
      const sub = ((c.subclassDefinition && c.subclassDefinition.name) || '').toLowerCase().trim();
      const lvl = c.level || 0;
      // spellCastingAbilityId shows up in a couple of different spots
      // depending on payload variant — this is the same signal already
      // used elsewhere on the sheet for spell DC / attack bonus.
      const canCast = !!(def.spellCastingAbilityId || c.spellCastingAbilityId ||
        (c.subclassDefinition && c.subclassDefinition.spellCastingAbilityId));
      if (name === 'warlock') { matchedAnyCaster = true; return; } // Pact Magic, handled separately
      if (name === 'artificer') { casterLevel += Math.ceil(lvl / 2); matchedAnyCaster = true; return; }
      if (HALF_CASTER_CLASSES.has(name)) { casterLevel += Math.floor(lvl / 2); matchedAnyCaster = true; return; }
      if (THIRD_CASTER_SUBCLASSES.has(sub)) { casterLevel += Math.floor(lvl / 3); matchedAnyCaster = true; return; }
      if (FULL_CASTER_CLASSES.has(name)) { casterLevel += lvl; matchedAnyCaster = true; return; }
      if (canCast) { casterLevel += lvl; matchedAnyCaster = true; } // unrecognized name, but flagged as a caster
    });
    if (!matchedAnyCaster && hasLeveledSpells) {
      // Nothing matched by name/flag at all, yet the character has real
      // leveled spells — best-effort fallback so slots aren't just empty.
      casterLevel = totalLevel(data);
    }
    if (casterLevel > 0) {
      const row = MULTICLASS_SLOT_TABLE[Math.min(20, casterLevel)] || [];
      row.forEach((count, i) => { if (count > 0) map[i + 1] = (map[i + 1] || 0) + count; });
    }
    const warlock = (data.classes || []).find((c) => ((c.definition && c.definition.name) || '').toLowerCase() === 'warlock');
    if (warlock) {
      const pact = PACT_MAGIC_TABLE[Math.min(20, warlock.level || 0)];
      if (pact && pact.slots > 0) map[pact.level] = (map[pact.level] || 0) + pact.slots;
    }
    return map;
  }

  function spellSlotDefaults(data, hasLeveledSpells) {
    const map = {};
    const computedMax = computeMaxSpellSlots(data, hasLeveledSpells);
    Object.keys(computedMax).forEach((lvl) => {
      map[lvl] = { used: 0, max: computedMax[lvl] };
    });
    // Only trust the JSON for how many slots are currently SPENT — the max
    // per level always comes from our own level-based table above, never
    // from the payload (which is frequently stale/wrong for this field).
    const raw = data.spellSlots || data.pactMagic || [];
    (Array.isArray(raw) ? raw : []).forEach((s) => {
      if (!s || s.level == null) return;
      if (!map[s.level]) map[s.level] = { used: 0, max: 0 };
      map[s.level].used = s.used || 0;
    });
    return map;
  }

  function renderActions(data, scores, prof) {
    const panel = el('actionsPanel');
    if (!panel) return;

    const spellAbilityIdx = spellcastingAbilityIndex(data, scores);
    const spellDC = spellAbilityIdx != null ? 8 + prof + mod(scores[spellAbilityIdx]) : null;
    const spellAtk = spellAbilityIdx != null ? prof + mod(scores[spellAbilityIdx]) : null;
    const detailStore = [];

    // ---- Full-word activation-cost label (e.g. "Action", "Bonus Action")
    // for the mobile two-tier card's cost badge. The econ section a row
    // lives in is authoritative (weapon attacks don't carry their own
    // activation data), with activationInfo() as a fallback for the
    // "other" section, which mixes several real activation types. ----
    const ECON_COST_LABELS = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction' };
    function econCostLabel(econCat, a) {
      return ECON_COST_LABELS[econCat] || (activationInfo(a).label || 'Other');
    }

    // ---- Attack table row for a weapon or damaging action ----
    function attackRow(a, scores, econCat) {
      let range = '—', hitDc = '—', dmg = '—';
      let nameExtra = '';

      if (a.isWeapon) {
        const def = a.weaponDef;
        range = def.range
          ? `${def.range} ft`
          : (def.properties && def.properties.some(p => p.name === 'Thrown') ? '20/60 ft' : '5 ft');
        const abilityIdx = (def.properties && def.properties.some(p => p.name === 'Finesse'))
          ? (mod(scores[1]) > mod(scores[0]) ? 1 : 0)
          : (def.attackType === 2 ? 1 : 0);
        const atkBonus = mod(scores[abilityIdx]) + prof;
        hitDc = `<span class="atk-box">${signed(atkBonus)}</span>`;
        const dmgDie = diceString(def.damage);
        const dmgType = def.damageType || (def.damage && DAMAGE_TYPE_NAMES[def.damage.damageTypeId]) || '';
        const dmgStr = dmgDie ? `${dmgDie} ${signed(mod(scores[abilityIdx]))} ${dmgType}`.trim() : (extractDamage(def, '') || '—');
        dmg = `<span class="dmg-box">${escapeHtml(dmgStr)}</span>`;
      } else {
        if (a.range && (a.range.range || a.range.aoeValue))
          range = a.range.range ? `${a.range.range} ft` : `${a.range.aoeValue} ft (AoE)`;
        const abilityIdx = a.abilityModifierStatId ? a.abilityModifierStatId - 1 : null;
        const notes = stripHtml(a.snippet || a.description || '');
        if (a.dice && abilityIdx != null) {
          hitDc = `<span class="atk-box">${signed(prof + mod(scores[abilityIdx]))}</span>`;
          const dmgType = a.damageTypeId ? DAMAGE_TYPE_NAMES[a.damageTypeId] || '' : '';
          dmg = `<span class="dmg-box">${escapeHtml(`${diceString(a.dice)} ${signed(mod(scores[abilityIdx]))} ${dmgType}`.trim())}</span>`;
        } else if (a.dice) {
          dmg = `<span class="dmg-box">${escapeHtml(diceString(a.dice))}</span>`;
        } else {
          const extracted = extractDamage(a, notes);
          if (extracted) dmg = `<span class="dmg-box">${escapeHtml(extracted)}</span>`;
          const dcText = extractDcFromText(notes);
          if (dcText) hitDc = `<span class="atk-box">${escapeHtml(dcText)}</span>`;
        }
      }

      if (a.limitedUse) {
        const reset = RESET_TYPE_NAMES[a.limitedUse.resetType] || 'recharge';
        nameExtra = ` <span class="equipped-flag">${a.limitedUse.maxUses} Use / ${reset}</span>`;
      }

      // Store full description for click-to-open
      let detailAttr = '';
      const fullDesc = a.description || a.snippet || '';
      if (fullDesc) {
        const idx = detailStore.length;
        detailStore.push({ title: a.name || 'Unnamed', tagline: '', meta: [], body: parseRichBody(fullDesc) });
        detailAttr = ` data-detail-idx="${idx}"`;
      }

      const subtype = a.isWeapon
        ? (a.weaponDef.type || a.weaponDef.filterType || 'Melee Attack')
        : ((activationInfo(a).label || '') + (a.sourceEntityName ? ` · ${a.sourceEntityName}` : ''));

      // Mobile-only badge (hidden on desktop, see dnd-sheet.css) showing
      // the full-word activation cost — "Action", "Bonus Action", etc.
      const costBadge = `<span class="atk-cost-badge">${escapeHtml(econCostLabel(econCat, a))}</span>`;

      return `<li class="atk-row"${detailAttr}>
        ${costBadge}
        <span class="atk-name-cell">
          <span class="atk-name">${escapeHtml(a.name || 'Unnamed')}${nameExtra}</span>
          <span class="atk-sub">${escapeHtml(subtype)}</span>
        </span>
        <span class="atk-range">${escapeHtml(range)}</span>
        <span class="atk-hit-cell">${hitDc}</span>
        <span class="atk-dmg-cell">${dmg}</span>
        <span class="atk-notes">&mdash;</span>
      </li>`;
    }

    // ---- Feature card for a non-attack ability (with optional checkbox tracker) ----
    function featureCard(a) {
      const title = escapeHtml(a.name || 'Unnamed');
      const blocks = parseRichBody(a.description || a.snippet || '');
      // Preview line under the title: first bit of prose only — if the
      // description starts straight into a table (e.g. Beast Shapes),
      // there's no sensible one-line preview, so it's just left blank and
      // the full table shows up when the card is opened.
      const firstTextBlock = blocks.find((b) => b.type === 'text');
      const preview = firstTextBlock ? firstTextBlock.text.split('\n\n')[0] : '';

      let trackerHtml = '';
      if (a.limitedUse) {
        const reset = RESET_TYPE_NAMES[a.limitedUse.resetType] || 'recharge';
        const maxUses = a.limitedUse.maxUses || 1;
        const boxes = Array.from({ length: maxUses }, (_, i) =>
          `<button type="button" class="limit-box" data-idx="${i}" aria-pressed="false" aria-label="Use ${i + 1}"></button>`
        ).join('');
        // Only short rest (1) / long rest (2) / dawn (3) are rest-button
        // resettable — plain "recharge" resources (roll a die at the start
        // of your turn) are left alone since a rest doesn't restore those.
        const resetTypeAttr = [1, 2, 3].includes(a.limitedUse.resetType) ? ` data-reset-type="${a.limitedUse.resetType}"` : '';
        trackerHtml = `<div class="limit-tracker"${resetTypeAttr}>${boxes}<span class="limit-reset">/ ${reset}</span></div>`;
      }

      let detailAttr = '';
      if (blocks.length) {
        const idx = detailStore.length;
        detailStore.push({ title: a.name || 'Unnamed', tagline: '', meta: [], body: blocks });
        detailAttr = ` data-detail-idx="${idx}"`;
      }

      return `<div class="feature-card"${detailAttr}>
        <div class="feature-card-hdr">
          <span class="feature-card-title">${title}</span>
          ${a.limitedUse ? `<span class="equipped-flag">${a.limitedUse.maxUses}/${RESET_TYPE_NAMES[a.limitedUse.resetType] || 'recharge'}</span>` : ''}
        </div>
        <p class="feature-card-body">${escapeHtml(preview)}</p>
        ${trackerHtml}
      </div>`;
    }

    // ---- Partition all actions by economy section ----
    const rawActions = collectActions(data);

    // Attacks: weapon attacks + actions with dice that have a structured abilityModifierStatId
    const isAttack = a => a.isWeapon || (a.dice && a.abilityModifierStatId != null);

    const sections = [
      {
        id: 'act-section-action',
        label: 'ACTIONS',
        econCat: 'action',
        meta: `Attacks per Action: ${1 + sumModifiers(data, 'bonus', 'extra-attacks')}`,
        combatRules: 'Attack, Dash, Disengage, Dodge, Grapple, Help, Hide, Improvise, Influence, Magic, Ready, Search, Shove, Study, Utilize'
      },
      {
        id: 'act-section-bonus',
        label: 'BONUS ACTIONS',
        econCat: 'bonus',
        combatRules: 'Two-Weapon Fighting'
      },
      {
        id: 'act-section-reaction',
        label: 'REACTIONS',
        econCat: 'reaction',
        combatRules: 'Opportunity Attack'
      },
      {
        id: 'act-section-other',
        label: 'OTHER',
        econCat: 'other',
        combatRules: 'Interact with an Object'
      }
    ];

    // Weapon attacks always go in ACTIONS section
    const weaponAttacks = rawActions.filter(a => a.isWeapon);
    const nonWeapon = rawActions.filter(a => !a.isWeapon);

    let html = '';
    sections.forEach(sec => {
      // Non-weapon actions matching this economy section
      const secActions = sec.econCat === 'action'
        ? nonWeapon.filter(a => activationInfo(a).category === 'action' || activationInfo(a).category === 'limited')
        : nonWeapon.filter(a => activationInfo(a).category === sec.econCat);

      // Attacks for this section: weapons only go to action, others by category
      const attackList = sec.econCat === 'action'
        ? [...weaponAttacks, ...secActions.filter(isAttack)]
        : secActions.filter(isAttack);
      const featureList = secActions.filter(a => !isAttack(a));

      // Always render the section (even if empty) so subtab filtering can show/hide it
      const hasContent = attackList.length || featureList.length;

      html += `<div class="act-section" data-econcat="${sec.econCat}">
        <div class="act-section-hdr">
          <span class="act-section-title">${sec.label}${sec.meta ? ` <span class="act-section-meta">• ${sec.meta}</span>` : ''}</span>
        </div>`;

      if (attackList.length) {
        html += `<div class="atk-table-scroll">
          <div class="action-table-head"><span>Attack</span><span>Range</span><span>Hit / DC</span><span>Damage</span><span>Notes</span></div>
          <ul class="action-list">
            ${attackList.map(a => attackRow(a, scores, sec.econCat)).join('')}
          </ul>
        </div>`;
      }

      if (sec.combatRules) {
        html += `<div class="act-combat-rules"><strong>Actions in Combat</strong> <span>${escapeHtml(sec.combatRules)}</span></div>`;
      }

      featureList.forEach(a => { html += featureCard(a); });

      if (!hasContent) {
        html += `<p class="act-empty">No ${sec.label.toLowerCase()} found for this character.</p>`;
      }

      html += `</div>`;
    });

    panel.innerHTML = html;

    // Click feature card header or body → open detail modal
    panel.addEventListener('click', e => {
      // Limit-box toggle (interactive resource tracker)
      const box = e.target.closest('.limit-box');
      if (box) {
        const tracker = box.closest('.limit-tracker');
        const boxes = Array.from(tracker.querySelectorAll('.limit-box'));
        const idx = parseInt(box.dataset.idx, 10);
        const pressed = box.getAttribute('aria-pressed') === 'true';
        // Fill up to idx (toggle off if clicking the last filled box)
        const newCount = pressed ? idx : idx + 1;
        boxes.forEach((b, i) => {
          const on = i < newCount;
          b.setAttribute('aria-pressed', String(on));
          b.classList.toggle('is-used', on);
        });
        return;
      }
      // Detail modal
      const card = e.target.closest('[data-detail-idx]');
      if (!card) return;
      openDetailModal(detailStore[Number(card.dataset.detailIdx)]);
    });

    // ---- Action subtab filtering ----
    const subtabNav = el('actionSubtabNav');
    const mobileActSelect = el('mobileActionFilter');
    if (!subtabNav && !mobileActSelect) return;

    function applyActionSubtab() {
      const active = subtabNav ? subtabNav.querySelector('.action-subtab-btn.action-subtab-active') : null;
      const sub = active ? active.dataset.actsubtab : (mobileActSelect ? mobileActSelect.value : 'all');

      if (mobileActSelect && mobileActSelect.value !== sub) {
        mobileActSelect.value = sub;
      }

      panel.querySelectorAll('.act-section').forEach(sec => {
        const cat = sec.dataset.econcat;
        switch (sub) {
          case 'all': sec.style.display = ''; break;
          case 'attack': sec.style.display = ''; break; // show all sections, hide non-attack rows below
          case 'action': sec.style.display = cat === 'action' ? '' : 'none'; break;
          case 'bonus': sec.style.display = cat === 'bonus' ? '' : 'none'; break;
          case 'reaction': sec.style.display = cat === 'reaction' ? '' : 'none'; break;
          case 'other': sec.style.display = cat === 'other' ? '' : 'none'; break;
          case 'limited': sec.style.display = ''; break;
          default: sec.style.display = '';
        }

        // Within visible sections, control which rows/cards appear
        sec.querySelectorAll('.atk-row').forEach(row => {
          row.style.display = (sub === 'all' || sub === 'attack' || sub === 'action' || sub === 'bonus' || sub === 'reaction') ? '' : 'none';
        });
        sec.querySelectorAll('.act-combat-rules').forEach(el => {
          el.style.display = (sub === 'all' || sub === 'action' || sub === 'bonus' || sub === 'reaction' || sub === 'other') ? '' : 'none';
        });
        sec.querySelectorAll('.feature-card').forEach(card => {
          const hasTracker = card.querySelector('.limit-tracker');
          if (sub === 'limited') {
            card.style.display = hasTracker ? '' : 'none';
          } else if (sub === 'attack') {
            card.style.display = 'none';
          } else {
            card.style.display = '';
          }
        });
      });

      // Limited Use subtab: show all sections but only the feature cards that have trackers
      if (sub === 'limited') {
        panel.querySelectorAll('.act-section').forEach(sec => {
          const hasVisible = sec.querySelector('.feature-card[style=""]') ||
            (sec.querySelector('.feature-card') && !sec.querySelector('.feature-card[style*="none"]'));
          sec.style.display = '';
        });
      }
    }

    if (subtabNav) {
      subtabNav.addEventListener('click', e => {
        const btn = e.target.closest('.action-subtab-btn');
        if (!btn) return;
        subtabNav.querySelectorAll('.action-subtab-btn').forEach(b => {
          b.classList.remove('action-subtab-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('action-subtab-active');
        btn.setAttribute('aria-selected', 'true');
        applyActionSubtab();
      });
    }

    if (mobileActSelect) {
      mobileActSelect.addEventListener('change', e => {
        const val = e.target.value;
        if (subtabNav) {
          subtabNav.querySelectorAll('.action-subtab-btn').forEach(b => {
            const match = b.dataset.actsubtab === val;
            b.classList.toggle('action-subtab-active', match);
            b.setAttribute('aria-selected', match ? 'true' : 'false');
          });
        }
        applyActionSubtab();
      });
    }

    applyActionSubtab();
  }

  // ------------------------------------------------------------------
  // Spells — rendered into the dedicated SPELLS main tab.
  // Circle spells (from druid subclass circle feature) are excluded.
  // ------------------------------------------------------------------
  function renderSpells(data, scores, prof) {
    const list = el('spellList');
    if (!list) return;

    const spellAbilityIdx = spellcastingAbilityIndex(data, scores);
    const spellDC = spellAbilityIdx != null ? 8 + prof + mod(scores[spellAbilityIdx]) : null;
    const spellAtk = spellAbilityIdx != null ? prof + mod(scores[spellAbilityIdx]) : null;
    const spellModVal = spellAbilityIdx != null ? mod(scores[spellAbilityIdx]) : null;

    // Populate casting stats strip
    const fmtStat = n => n != null ? signed(n) : '—';
    const setEl = (id, v) => { const e = el(id); if (e) e.textContent = v; };
    setEl('spellMod', fmtStat(spellModVal));
    setEl('spellAtk', fmtStat(spellAtk));
    setEl('spellSaveDC', spellDC != null ? String(spellDC) : '—');

    const detailStore = [];

    // Activation time → short abbreviation (1A, 1BA, 1R, 1m, 1h…)
    function timeAbbr(def) {
      const act = def.activation || {};
      const t = act.activationType;
      const n = act.activationTime || 1;
      const map = { 1: 'A', 2: '–', 3: 'BA', 4: 'R', 5: 'm', 6: 'h', 7: 'Spec' };
      return map[t] ? (n > 1 ? `${n}${map[t]}` : `1${map[t]}`) : '—';
    }

    // Build source class name for the spell subtitle
    function spellSource(s) {
      if (s.componentId) return '';   // innate
      // classSpells entries carry a className via the parent classSpells entry
      return s._className || '';
    }

    // Collect and dedupe spells; exclude Circle-of-the-Land/Moon/etc. spells
    const rawSpells = dedupeSpells(collectSpells(data, { excludeCircle: true }));
    const hasLeveledSpells = rawSpells.some(s => (s.definition && s.definition.level) > 0);
    const slotDefaults = spellSlotDefaults(data, hasLeveledSpells);

    let maxSpellLevel = 0;
    Object.keys(slotDefaults).forEach(k => {
      const l = Number(k);
      if (slotDefaults[l] && slotDefaults[l].max > 0 && l > maxSpellLevel) maxSpellLevel = l;
    });

    // One spell row HTML
    function spellRow(s, castLevel) {
      const def = s.definition || {};
      const baseLevel = def.level != null ? def.level : 0;
      const level = castLevel != null ? castLevel : baseLevel;
      const isUpcast = level > baseLevel;
      const isConc = !!def.concentration;
      const isRitual = !!def.ritual;

      const conc = isConc ? '<span class="conc-icon" title="Concentration">◇</span>' : '';
      const ritual = isRitual ? '<span class="ritual-icon" title="Ritual">[R]</span>' : '';

      const components = (def.components || []).map(c => SPELL_COMPONENT_LETTERS[c] || '').join('');
      const duration = def.duration ? (def.duration.durationUnit
        ? `${def.duration.durationInterval || 1} ${def.duration.durationUnit}`
        : def.duration.durationType || '') : '';

      // Casting time abbreviation
      const timeStr = timeAbbr(def);

      // Range
      let range = '—';
      const r = def.range || {};
      if (r.origin && /self/i.test(r.origin) && !r.aoeValue) range = 'Self';
      else if (r.rangeValue) range = `${r.rangeValue} ft`;
      else if (r.origin) range = r.origin;

      // Hit / DC
      let hitDc = '—';
      if (def.requiresSavingThrow && spellDC != null) {
        const saveStat = ABILITY_NAMES[def.saveDcAbilityId - 1] || '';
        hitDc = `<span class="atk-box">${saveStat ? saveStat + ' ' : ''}${spellDC}</span>`;
      } else if (def.attackType && spellAtk != null) {
        hitDc = `<span class="atk-box">${signed(spellAtk)}</span>`;
      }

      // Effect / damage
      const notes = stripHtml(def.snippet || def.description || '');
      let dmg = extractDamage(def, notes) || '';
      const scaling = higherLevelRates(def);
      if (isUpcast && scaling) dmg = applyScaling(dmg, scalingAtLevel(scaling, level));
      let effect = dmg
        ? `<span class="dmg-box">${escapeHtml(dmg)}</span>`
        : (def.requiresSavingThrow ? 'Save' : (def.attackType ? 'Spell Atk' : 'Utility'));

      // Notes column
      const aoe = r.aoeValue ? `${r.aoeValue} ft ${r.aoeType || ''}` : '';
      const notesParts = [components, duration, aoe].filter(Boolean);
      const notesStr = notesParts.join(', ');

      // Action badge
      const upcastFlag = isUpcast ? `<span class="upcast-flag" title="Cast using a higher-level slot">↑ Upcast</span>` : '';
      const badge = baseLevel === 0
        ? '<span class="spell-at-will">AT WILL</span>'
        : `<button type="button" class="spell-cast-btn" data-cast-level="${level}">CAST</button>`;

      // Mobile-only badge (hidden on desktop, see dnd-sheet.css) showing
      // the full-word activation cost — "Action", "Bonus Action", etc —
      // distinct from the abbreviated .spell-time cell ("1A") used in
      // the desktop Time column.
      const costLabel = activationInfo(def).label || 'Action';
      const costBadge = `<span class="spell-cost-badge">${escapeHtml(costLabel)}</span>`;

      // Source class / school
      const school = SPELL_SCHOOL_NAMES[def.school] || '';
      const src = s._className ? escapeHtml(s._className) : escapeHtml(school);

      // Store detail for modal
      let detailAttr = '';
      if (def.description || def.snippet) {
        const idx = detailStore.length;
        detailStore.push({
          title: def.name || 'Unnamed Spell',
          tagline: [range !== '—' ? `Range: ${range}` : '', duration ? `Duration: ${duration}` : '', school].filter(Boolean).join(' · '),
          meta: [components ? `Components: ${components}` : '', scaling ? `Scales: ${formatScaling(def, scaling)}` : ''].filter(Boolean),
          body: parseRichBody(def.description || def.snippet || '')
        });
        detailAttr = ` data-detail-idx="${idx}"`;
      }

      return `<li class="spell-row${isUpcast ? ' spell-row-upcast' : ''}"
          data-level="${level}"
          data-base-level="${baseLevel}"
          data-conc="${isConc}"
          data-ritual="${isRitual}"
          data-upcast="${isUpcast}"
          data-name="${escapeHtml((def.name || '').toLowerCase())}"
          data-school="${escapeHtml(school.toLowerCase())}"
          data-time="${escapeHtml(timeStr.toLowerCase())}"
          ${detailAttr}>
        ${costBadge}
        <span class="spell-badge-cell">${badge}</span>
        <span class="spell-name-cell">
          <span class="spell-name">${escapeHtml(def.name || 'Unnamed')}${conc}${ritual}</span>
          <span class="spell-src">${src}${upcastFlag}</span>
        </span>
        <span class="spell-time">${escapeHtml(timeStr)}</span>
        <span class="spell-range">${escapeHtml(range)}</span>
        <span class="spell-hit-cell">${hitDc}</span>
        <span class="spell-effect-cell">${effect}</span>
        <span class="spell-notes">${escapeHtml(notesStr) || '&mdash;'}</span>
      </li>`;
    }

    // Group by level
    const byLevel = {};
    rawSpells.forEach(s => {
      const def = s.definition || {};
      const lvl = def.level != null ? def.level : 0;
      (byLevel[lvl] = byLevel[lvl] || []).push(s);
    });

    // Spells that scale when cast with a higher-level slot (e.g. Chromatic
    // Orb) also show up under every higher spell level they could be cast
    // at — same spell, same slot economy, just cast bigger. Cantrips are
    // excluded since they scale with character level, not slots.
    const upcastableSpells = rawSpells.filter(s => {
      const def = s.definition || {};
      const lvl = def.level != null ? def.level : 0;
      return lvl > 0 && !!higherLevelRates(def);
    });

    // Highest slot level
    rawSpells.forEach(s => {
      const def = s.definition || {};
      const lvl = def.level != null ? def.level : 0;
      if (lvl > maxSpellLevel) maxSpellLevel = lvl;
    });

    const levelSet = new Set(Object.keys(byLevel).map(Number));
    for (let l = 1; l <= maxSpellLevel; l++) {
      if (slotDefaults[l] && slotDefaults[l].max > 0) levelSet.add(l);
    }
    const levels = [...levelSet].sort((a, b) => a - b);

    let spellHtml = '';
    levels.forEach(lvl => {
      const label = lvl === 0 ? 'CANTRIP' : `${ordinal(lvl).toUpperCase()} LEVEL`;

      let slotEditorHtml = '';
      if (lvl > 0) {
        const slot = slotDefaults[lvl] || { used: 0, max: 0 };
        const cubes = Array.from({ length: slot.max }, (_, i) =>
          `<button type="button"
            class="spell-slot-cube${i < slot.used ? ' used' : ''}"
            data-level="${lvl}" data-index="${i}"
            aria-pressed="${i < slot.used ? 'true' : 'false'}"
            aria-label="Level ${lvl} spell slot ${i + 1}${i < slot.used ? ' (used)' : ''}"></button>`
        ).join('');
        slotEditorHtml = `<span class="spell-slot-editor">
          <span class="spell-slot-cubes" data-level="${lvl}" data-max="${slot.max}">${cubes || '<span class="spell-slot-none">—</span>'}</span>
          <span class="spell-slot-caption">SLOTS</span>
        </span>`;
      }

      spellHtml += `<li class="spell-level-header" data-level="${lvl}">
        <span class="spell-level-title">${label}</span>
        ${slotEditorHtml}
      </li>`;

      const baseRows = (byLevel[lvl] || []).map(s => spellRow(s));
      const upcastRows = lvl > 0
        ? upcastableSpells
          .filter(s => ((s.definition && s.definition.level != null) ? s.definition.level : 0) < lvl)
          .sort((a, b) => (a.definition.name || '').localeCompare(b.definition.name || ''))
          .map(s => spellRow(s, lvl))
        : [];
      spellHtml += baseRows.join('') + upcastRows.join('');
    });

    list.innerHTML = spellHtml || '<li class="empty-row">No spells found on this character.</li>';

    // Slot cube interaction (same as before — click to spend/restore)
    list.querySelectorAll('.spell-slot-cubes').forEach(group => {
      const cubes = Array.from(group.querySelectorAll('.spell-slot-cube'));
      cubes.forEach((cube, i) => {
        cube.onclick = e => {
          e.stopPropagation();
          const wasUsed = cube.classList.contains('used');
          const newUsedCount = wasUsed ? i : i + 1;
          cubes.forEach((c, j) => {
            const used = j < newUsedCount;
            c.classList.toggle('used', used);
            c.setAttribute('aria-pressed', used ? 'true' : 'false');
          });
        };
      });
    });

    // Cast button — spends the first free slot of that spell's level and
    // reflects it immediately on the level's slot cubes. If none are
    // left, gives a quick shake/red flash instead of silently failing.
    list.querySelectorAll('.spell-cast-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const lvl = btn.dataset.castLevel;
        const cubesGroup = list.querySelector(`.spell-slot-cubes[data-level="${lvl}"]`);
        const cubes = cubesGroup ? Array.from(cubesGroup.querySelectorAll('.spell-slot-cube')) : [];
        const nextFree = cubes.find(c => !c.classList.contains('used'));

        if (!nextFree) {
          btn.classList.remove('spell-cast-flash');
          void btn.offsetWidth; // restart animation if clicked repeatedly
          btn.classList.add('spell-cast-empty');
          setTimeout(() => btn.classList.remove('spell-cast-empty'), 400);
          return;
        }

        nextFree.classList.add('used');
        nextFree.setAttribute('aria-pressed', 'true');
        btn.classList.remove('spell-cast-empty');
        void btn.offsetWidth;
        btn.classList.add('spell-cast-flash');
        setTimeout(() => btn.classList.remove('spell-cast-flash'), 400);
      };
    });

    // Click spell row → detail modal
    list.onclick = e => {
      if (e.target.closest('.spell-slot-cube') || e.target.closest('.spell-cast-btn')) return;
      const row = e.target.closest('li[data-detail-idx]');
      if (!row) return;
      openDetailModal(detailStore[Number(row.dataset.detailIdx)]);
    };

    // ---- Level / concentration / ritual pill filtering ----
    const pillRow = el('spellLevelPills');
    const mobileSpellSelect = el('mobileSpellFilter');
    const searchInput = el('spellSearchInput');

    function applySpellFilter() {
      const active = pillRow ? pillRow.querySelector('.spell-pill.spell-pill-active') : null;
      const pill = active ? active.dataset.spellpill : (mobileSpellSelect ? mobileSpellSelect.value : 'all');
      const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

      if (mobileSpellSelect && mobileSpellSelect.value !== pill) {
        mobileSpellSelect.value = pill;
      }

      let currentHeaderVisible = false;
      let headerEl = null;

      list.querySelectorAll('li').forEach(li => {
        if (li.classList.contains('spell-level-header')) {
          // Decide after processing all rows in this group
          headerEl = li;
          currentHeaderVisible = false;
          return;
        }
        // Filter by pill
        const lvl = parseInt(li.dataset.level, 10);
        const conc = li.dataset.conc === 'true';
        const rit = li.dataset.ritual === 'true';

        let show = pill === 'all' ||
          (pill === 'conc' && conc) ||
          (pill === 'ritual' && rit) ||
          (pill !== 'conc' && pill !== 'ritual' && parseInt(pill, 10) === lvl);

        // Filter by search
        if (show && query) {
          const name = (li.dataset.name || '');
          const school = (li.dataset.school || '');
          const time = (li.dataset.time || '');
          const text = li.textContent.toLowerCase();
          show = name.includes(query) || school.includes(query) || time.includes(query) || text.includes(query);
        }

        li.style.display = show ? '' : 'none';
        if (show && headerEl) { headerEl.style.display = ''; currentHeaderVisible = true; }
      });
    }

    // ---- Only offer level pills/options the character can actually cast ----
    const hasCantrips = !!(byLevel[0] && byLevel[0].length);
    if (pillRow) {
      pillRow.querySelectorAll('.spell-pill[data-spellpill]').forEach(btn => {
        const val = btn.dataset.spellpill;
        if (val === 'all' || val === 'conc' || val === 'ritual') return;
        const lvlNum = Number(val);
        const available = lvlNum === 0 ? hasCantrips : lvlNum <= maxSpellLevel;
        btn.style.display = available ? '' : 'none';
      });
      const activePill = pillRow.querySelector('.spell-pill.spell-pill-active');
      if (activePill && activePill.style.display === 'none') {
        pillRow.querySelectorAll('.spell-pill').forEach(b => b.classList.remove('spell-pill-active'));
        const allBtn = pillRow.querySelector('.spell-pill[data-spellpill="all"]');
        if (allBtn) allBtn.classList.add('spell-pill-active');
      }
    }

    if (mobileSpellSelect) {
      Array.from(mobileSpellSelect.options).forEach(opt => {
        const val = opt.value;
        if (val === 'all' || val === 'conc' || val === 'ritual') return;
        const lvlNum = Number(val);
        const available = lvlNum === 0 ? hasCantrips : lvlNum <= maxSpellLevel;
        opt.style.display = available ? '' : 'none';
        opt.disabled = !available;
      });
    }

    if (pillRow) {
      pillRow.addEventListener('click', e => {
        const btn = e.target.closest('.spell-pill');
        if (!btn) return;
        pillRow.querySelectorAll('.spell-pill').forEach(b => b.classList.remove('spell-pill-active'));
        btn.classList.add('spell-pill-active');
        applySpellFilter();
      });
    }
    if (mobileSpellSelect) {
      mobileSpellSelect.addEventListener('change', e => {
        const val = e.target.value;
        if (pillRow) {
          pillRow.querySelectorAll('.spell-pill').forEach(b => {
            b.classList.toggle('spell-pill-active', b.dataset.spellpill === val);
          });
        }
        applySpellFilter();
      });
    }
    if (searchInput) {
      searchInput.addEventListener('input', applySpellFilter);
    }

    applySpellFilter();
  }



  function renderInventory(data) {
    const items = data.inventory || [];
    let totalWeight = 0;
    const list = el('inventoryList');

    const rows = items.map((item) => {
      const def = item.definition || {};
      const qty = item.quantity || 1;
      const weight = (def.weight || 0) * qty;
      totalWeight += weight;
      const flags = [];
      if (item.equipped) flags.push('Equipped');
      if (item.isAttuned) flags.push('Attuned');
      return {
        equipped: !!item.equipped,
        attuned: !!item.isAttuned,
        html: `<li data-equipped="${!!item.equipped}" data-attuned="${!!item.isAttuned}">
          <span class="item-name">${def.name || 'Item'}${flags.length ? '<span class="equipped-flag">' + flags.join(' · ') + '</span>' : ''}</span>
          <span>${qty}</span>
          <span>${weight ? weight.toFixed(1) + ' lb' : '—'}</span>
          <span>${(def.type || def.filterType || '')}</span>
        </li>`
      };
    });

    list.innerHTML = rows.length ? rows.map((r) => r.html).join('') : '<li class="empty-row">No items in inventory.</li>';
    el('invWeight').textContent = totalWeight.toFixed(1) + ' lb';

    const cur = data.currencies || {};
    const currencyEl = el('invCurrency');
    currencyEl.innerHTML = `
      <span class="coin coin-pp">${cur.pp || 0} pp</span>
      <span class="coin coin-gp">${cur.gp || 0} gp</span>
      <span class="coin coin-ep">${cur.ep || 0} ep</span>
      <span class="coin coin-sp">${cur.sp || 0} sp</span>
      <span class="coin coin-cp">${cur.cp || 0} cp</span>`;

    const filterRow = el('invFilterRow');
    filterRow.onclick = (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn) return;
      filterRow.querySelectorAll('.filter-chip').forEach((b) => b.classList.remove('filter-active'));
      btn.classList.add('filter-active');
      const f = btn.dataset.invfilter;
      list.querySelectorAll('li[data-equipped]').forEach((li) => {
        const show = f === 'all' ||
          (f === 'equipped' && li.dataset.equipped === 'true') ||
          (f === 'attuned' && li.dataset.attuned === 'true');
        li.style.display = show ? '' : 'none';
      });
    };
  }

  function renderFeatureList(targetId, entries, detailStore) {
    const list = el(targetId);
    if (!list) return;
    if (!entries.length) {
      list.innerHTML = '<li class="empty-row">None.</li>';
      return;
    }
    list.innerHTML = entries.map((f) => {
      let detailAttr = '';
      if (f.description) {
        const idx = detailStore.length;
        detailStore.push({
          title: f.name || 'Unnamed Feature',
          tagline: f.source || '',
          meta: [],
          body: parseRichBody(f.description)
        });
        detailAttr = ` data-detail-idx="${idx}"`;
      }
      const strippedDesc = stripHtml(f.description);
      const preview = strippedDesc ? strippedDesc.slice(0, 220) + (strippedDesc.length > 220 ? '…' : '') : '';
      return `<li${detailAttr}>
        <span class="feature-name">${escapeHtml(f.name || 'Unnamed')}</span>
        <span class="feature-source">${escapeHtml(f.source || '')}</span>
        <div class="feature-desc">${escapeHtml(preview)}</div>
      </li>`;
    }).join('');
  }

  function renderFeatures(data) {
    const detailStore = [];

    const classFeatures = [];
    (data.classes || []).forEach((c) => {
      const charLevel = c.level || 0;
      // The payload's classFeatures list isn't pre-filtered to what this
      // character actually has — it includes every subclass option for
      // the class (e.g. every Sorcerous Origin's features, not just the
      // one chosen) and every level up to 20, not just the levels
      // reached. Without filtering, a Sorcerer would see other origins'
      // capstones like Summon Dragon (Draconic Bloodline, 14th level)
      // even if they're a different origin or aren't level 14 yet.
      const chosenSubclassId = c.subclassDefinition &&
        (c.subclassDefinition.id != null ? c.subclassDefinition.id :
          (c.subclassDefinition.definition && c.subclassDefinition.definition.id));

      (c.classFeatures || []).forEach((f) => {
        const def = f.definition || {};

        // Skip features that belong to a subclass other than the one
        // this character chose.
        const featureSubclassId = def.subclassId != null ? def.subclassId : f.subclassId;
        if (featureSubclassId != null && featureSubclassId !== chosenSubclassId) return;

        // Skip features not yet unlocked at the character's current
        // level in this class.
        const requiredLevel = def.requiredLevel != null ? def.requiredLevel : f.requiredLevel;
        if (requiredLevel != null && requiredLevel > charLevel) return;

        classFeatures.push({
          name: def.name,
          source: c.definition && c.definition.name,
          description: def.description
        });
      });
    });

    const raceTraits = ((data.race && data.race.racialTraits) || []).map((t) => ({
      name: t.definition && t.definition.name,
      source: 'Species',
      description: t.definition && t.definition.description
    }));

    const feats = (data.feats || []).map((f) => ({
      name: f.definition && f.definition.name,
      source: 'Feat',
      description: f.definition && f.definition.description
    }));

    renderFeatureList('featuresClass', classFeatures.filter((f) => f.name && !isCircleSpellEntry(f.name)), detailStore);
    renderFeatureList('featuresRace', raceTraits.filter((f) => f.name && !isCircleSpellEntry(f.name)), detailStore);
    renderFeatureList('featuresFeat', feats.filter((f) => f.name && !isCircleSpellEntry(f.name)), detailStore);

    const container = document.querySelector('[data-tab-content="features"]');
    if (container) {
      container.querySelectorAll('[data-detail-idx]').forEach((item) => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.detailIdx, 10);
          if (!isNaN(idx) && detailStore[idx]) {
            openDetailModal(detailStore[idx]);
          }
        });
      });
    }
  }

  function renderBackground(data) {
    el('bgName').textContent = (data.background && data.background.definition && data.background.definition.name) || '—';
    el('bgAlignment').textContent = ALIGNMENTS[data.alignmentId] || '—';
    el('bgGender').textContent = data.gender || '—';
    el('bgAge').textContent = data.age || '—';
    el('bgHeight').textContent = data.height || '—';
    el('bgWeight').textContent = data.weight ? data.weight + ' lb' : '—';
    el('bgEyes').textContent = data.eyes || '—';
    el('bgSkin').textContent = data.skin || '—';
    el('bgHair').textContent = data.hair || '—';

    const traits = data.traits || {};
    el('bgPersonality').textContent = traits.personalityTraits || '—';
    el('bgIdeals').textContent = traits.ideals || '—';
    el('bgBonds').textContent = traits.bonds || '—';
    el('bgFlaws').textContent = traits.flaws || '—';
  }

  const ALIGNMENTS = {
    1: 'Lawful Good', 2: 'Neutral Good', 3: 'Chaotic Good',
    4: 'Lawful Neutral', 5: 'True Neutral', 6: 'Chaotic Neutral',
    7: 'Lawful Evil', 8: 'Neutral Evil', 9: 'Chaotic Evil'
  };

  function renderNotes(data) {
    const notes = data.notes || {};
    el('noteOrgs').textContent = notes.organizations || '—';
    el('noteAllies').textContent = notes.allies || '—';
    el('noteEnemies').textContent = notes.enemies || '—';
    el('noteBackstory').textContent = notes.backstory || '—';
    el('noteOther').textContent = notes.otherNotes || '—';
  }

  // On the real D&D Beyond sheet, the "Extras" tab is backed by the
  // "Manage Extras" / "Creatures" panel — Pet, Mount, Familiar, Beast
  // Companion, or any other summoned/companion creature (e.g. a
  // warlock's Pact of the Chain familiar, a druid's Conjure Animals
  // summon, or a homebrew companion like "Ignatius"). The unofficial
  // payload's field name for this list isn't nailed down across every
  // character variant, so this checks the known/likely spots and uses
  // whichever one actually has entries.
  function collectCreatures(data) {
    const candidates = [data.creatures, data.pets, data.companions, data.extras];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) return c;
    }
    return [];
  }

  function renderExtras(data) {
    const list = el('extrasList');
    const creatures = collectCreatures(data);
    if (!creatures.length) {
      list.innerHTML = '<li class="empty-row">No companions, summons, or wild shapes.</li>';
      return;
    }
    list.innerHTML = creatures.map((c) => {
      const def = c.definition || {};
      const name = c.name || def.name || 'Unnamed Creature';
      const typeLabel = c.creatureType || c.type || def.type || def.creatureType ||
        def.creatureTypeName || '';

      const statBits = [];
      const ac = c.armorClass != null ? c.armorClass : def.armorClass;
      if (ac != null) statBits.push(`AC ${ac}`);
      const hp = c.hitPoints != null ? c.hitPoints :
        (c.averageHitPoints != null ? c.averageHitPoints : (def.hitPoints != null ? def.hitPoints : def.averageHitPoints));
      if (hp != null) statBits.push(`HP ${hp}`);
      const speed = c.speed || def.speed;
      if (speed) {
        const walkSpeed = typeof speed === 'object' ? (speed.walk || Object.values(speed)[0]) : speed;
        if (walkSpeed) statBits.push(`Speed ${walkSpeed} ft`);
      }

      const desc = stripHtml(c.notes || c.description || def.description || '').slice(0, 220);
      const descLine = [statBits.join(' · '), desc].filter(Boolean).join(' — ');

      return `<li>
        <span class="feature-name">${name}</span>
        <span class="feature-source">${typeLabel}</span>
        <div class="feature-desc">${descLine}</div>
      </li>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // Tabs
  // ------------------------------------------------------------------
  function initTabs() {
    const nav = el('tabNav');
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      nav.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('tab-active'));
      btn.classList.add('tab-active');
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach((c) => {
        c.classList.toggle('tab-active', c.dataset.tabContent === target);
      });
    });
  }

  // ------------------------------------------------------------------
  // Simplified-view tab nav — the same fluid, gliding indicator used by
  // the Astral Requiem site header nav: it slides beneath whatever tab
  // is hovered and settles back under the active one once the pointer
  // leaves. Written standalone (not touching whatever switches
  // .tab-active on these buttons in simplified-mode.js) — a
  // MutationObserver just watches for that class to move and reacts,
  // so this works no matter how the tab switching itself is wired up.
  // ------------------------------------------------------------------
  function initSimpleNavIndicator() {
    const navBar = el('simpleTabNav');
    const indicator = el('simpleNavIndicator');
    if (!navBar || !indicator) return;
    const tabBtns = () => Array.from(navBar.querySelectorAll('.tab-btn'));

    function moveIndicatorTo(btn) {
      if (!btn) return;
      const barRect = navBar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      indicator.style.left = (btnRect.left - barRect.left) + 'px';
      indicator.style.width = btnRect.width + 'px';
      indicator.style.opacity = '1';
      tabBtns().forEach((b) => b.classList.toggle('nav-lit', b === btn));
    }

    function settleIndicator() {
      const active = navBar.querySelector('.tab-btn.tab-active');
      if (active) {
        moveIndicatorTo(active);
      } else {
        indicator.style.opacity = '0';
        tabBtns().forEach((b) => b.classList.remove('nav-lit'));
      }
    }

    tabBtns().forEach((btn) => {
      btn.addEventListener('mouseenter', () => moveIndicatorTo(btn));
    });
    navBar.addEventListener('mouseleave', settleIndicator);
    window.addEventListener('resize', settleIndicator);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(settleIndicator);
    }

    // React to whatever external code toggles .tab-active on these
    // buttons (a click handler in simplified-mode.js, most likely).
    const observer = new MutationObserver(() => settleIndicator());
    tabBtns().forEach((btn) => observer.observe(btn, { attributes: true, attributeFilter: ['class'] }));

    // Also re-settle once the simplified view becomes visible (it's
    // display:none until the view toggle switches to it, so an initial
    // measurement while hidden would get a 0-width rect).
    const simpleShell = document.getElementById('simpleShell');
    if (simpleShell) {
      new MutationObserver(() => { if (simpleShell.classList.contains('is-active')) settleIndicator(); })
        .observe(simpleShell, { attributes: true, attributeFilter: ['class'] });
    }

    settleIndicator();
  }

  // ------------------------------------------------------------------
  // Full-Sheet tab nav (Actions / Spells / Inventory / …) — the exact
  // same fluid, gliding indicator treatment as the Simplified View tab
  // bar above. A MutationObserver watches for .tab-active moving (set
  // by initTabs()'s click handler) so this stays decoupled from the
  // click-handling logic itself.
  // ------------------------------------------------------------------
  function initTabNavIndicator() {
    const navBar = el('tabNav');
    const indicator = el('tabNavIndicator');
    if (!navBar || !indicator) return;
    const tabBtns = () => Array.from(navBar.querySelectorAll('.tab-btn'));

    function moveIndicatorTo(btn) {
      if (!btn) return;
      const barRect = navBar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      indicator.style.left = (btnRect.left - barRect.left) + 'px';
      indicator.style.width = btnRect.width + 'px';
      indicator.style.opacity = '1';
      tabBtns().forEach((b) => b.classList.toggle('nav-lit', b === btn));
    }

    function settleIndicator() {
      const active = navBar.querySelector('.tab-btn.tab-active');
      if (active) {
        moveIndicatorTo(active);
      } else {
        indicator.style.opacity = '0';
        tabBtns().forEach((b) => b.classList.remove('nav-lit'));
      }
    }

    tabBtns().forEach((btn) => {
      btn.addEventListener('mouseenter', () => moveIndicatorTo(btn));
    });
    navBar.addEventListener('mouseleave', settleIndicator);
    window.addEventListener('resize', settleIndicator);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(settleIndicator);
    }

    const observer = new MutationObserver(() => settleIndicator());
    tabBtns().forEach((btn) => observer.observe(btn, { attributes: true, attributeFilter: ['class'] }));

    // Re-settle once the full sheet becomes visible again (it's
    // display:none while Simplified View is active, so a measurement
    // taken while hidden would get a 0-width rect).
    const csBody = document.querySelector('.cs-body');
    if (csBody) {
      new MutationObserver(() => { if (!csBody.classList.contains('simple-mode-hidden')) settleIndicator(); })
        .observe(csBody, { attributes: true, attributeFilter: ['class'] });
    }

    settleIndicator();
  }

  // ------------------------------------------------------------------
  // View toggle — single book icon button (next to Resync) that stands
  // in for the original two-button Full/Simplified toggle. The original
  // buttons are kept in the DOM (just visually hidden) so whatever
  // switches the view in simplified-mode.js keeps working unchanged —
  // this button simply dispatches a real click on whichever hidden
  // button represents the mode we're switching *to*, then mirrors
  // whatever state that leaves us in (via .view-toggle-active) onto
  // its own icon/label/pressed state.
  // ------------------------------------------------------------------
  function initViewToggleIcon() {
    const iconBtn = el('viewToggleBtn');
    const fullBtn = document.querySelector('#viewToggle [data-view="full"]');
    const simpleBtn = document.querySelector('#viewToggle [data-view="simplified"]');
    if (!iconBtn || !fullBtn || !simpleBtn) return;

    function sync() {
      const isSimplified = simpleBtn.classList.contains('view-toggle-active');
      iconBtn.classList.toggle('view-toggle-active', isSimplified);
      iconBtn.setAttribute('aria-pressed', String(isSimplified));
      iconBtn.title = isSimplified ? 'Switch to Full Sheet' : 'Switch to Simplified View';
    }

    iconBtn.addEventListener('click', () => {
      const isSimplified = simpleBtn.classList.contains('view-toggle-active');
      (isSimplified ? fullBtn : simpleBtn).click();
      // In case nothing external is listening (e.g. simplified-mode.js
      // isn't present), fall back to handling the switch ourselves.
      const stillUnchanged = simpleBtn.classList.contains('view-toggle-active') === isSimplified;
      if (stillUnchanged) {
        fullBtn.classList.toggle('view-toggle-active', isSimplified);
        simpleBtn.classList.toggle('view-toggle-active', !isSimplified);
        const csBody = document.querySelector('.cs-body');
        const simpleShell = el('simpleShell');
        if (csBody) csBody.classList.toggle('simple-mode-hidden', !isSimplified);
        if (simpleShell) simpleShell.classList.toggle('is-active', !isSimplified);
        document.documentElement.classList.toggle('simple-mode-active', !isSimplified);
      }
      sync();
      window.dispatchEvent(new Event('resize'));
    });

    // Stay in sync if anything else ever changes the underlying toggle.
    new MutationObserver(sync).observe(fullBtn, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(simpleBtn, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  // Every limited-use tracker rendered by featureCard() carries
  // data-reset-type="1|2|3" (short rest / long rest / dawn) when it's
  // rest-resettable at all. Clears every box for trackers matching the
  // given set of reset types.
  function resetLimitedUseTrackers(resetTypes) {
    document.querySelectorAll('.limit-tracker[data-reset-type]').forEach((tracker) => {
      if (!resetTypes.has(Number(tracker.dataset.resetType))) return;
      tracker.querySelectorAll('.limit-box').forEach((box) => {
        box.classList.remove('is-used');
        box.setAttribute('aria-pressed', 'false');
      });
    });
  }

  // Clears every spell-slot cube back to unused (the spellbook's slot
  // trackers are plain DOM state — see the click handlers in renderSpells).
  function resetAllSpellSlots() {
    document.querySelectorAll('.spell-slot-cube').forEach((cube) => {
      cube.classList.remove('used');
      cube.setAttribute('aria-pressed', 'false');
    });
  }

  function hasWarlockLevels(data) {
    return !!(data && (data.classes || []).some((c) =>
      ((c.definition && c.definition.name) || '').toLowerCase() === 'warlock'));
  }

  // Quick visual confirmation that the button actually did something.
  function pulseRestButton(btn) {
    if (!btn) return;
    btn.classList.remove('rest-pulse');
    void btn.offsetWidth; // restart the animation if clicked again quickly
    btn.classList.add('rest-pulse');
  }

  function initRestButtons() {
    const shortBtn = el('shortRestBtn');
    const longBtn = el('longRestBtn');
    if (!shortBtn || !longBtn) return;

    shortBtn.addEventListener('click', () => {
      // Short rest (PHB): doesn't auto-heal (spending Hit Dice for HP is a
      // player choice this sheet doesn't track), but anything that resets
      // on a short rest comes back — and for a Warlock, Pact Magic spell
      // slots recover on a short rest too (unlike every other caster's
      // slots, which need a long rest).
      resetLimitedUseTrackers(new Set([1]));
      if (hasWarlockLevels(lastCharacterData)) resetAllSpellSlots();
      pulseRestButton(shortBtn);
    });

    longBtn.addEventListener('click', () => {
      // Long rest (PHB): HP back to max, temporary HP is lost (it doesn't
      // carry over a long rest), every spell slot comes back, and every
      // limited-use resource that resets on a short rest, long rest, or
      // at dawn comes back too — a long rest is a superset of a short one.
      const curInput = el('valHPCurrent');
      const maxInput = el('valHPMax');
      const tempInput = el('valHPTemp');
      if (curInput && maxInput) curInput.value = maxInput.value;
      if (tempInput) tempInput.value = 0;
      updateHPFillBar();

      resetAllSpellSlots();
      resetLimitedUseTrackers(new Set([1, 2, 3]));
      pulseRestButton(longBtn);
    });
  }

  // ------------------------------------------------------------------
  // Get the character id to show: URL ?id= param takes priority (set when
  // navigating here from the index.html Characters tab), then localStorage
  // remembers the last character viewed, and finally we fall back to the
  // first known character so the page is never blank.
  // ------------------------------------------------------------------
  function resolveStartId() {
    const urlId = new URLSearchParams(location.search).get('id');
    if (urlId && KNOWN_CHARACTERS.some((c) => c.id === urlId)) return urlId;
    const lastId = localStorage.getItem(LAST_CHAR_KEY);
    if (lastId && KNOWN_CHARACTERS.some((c) => c.id === lastId)) return lastId;
    return KNOWN_CHARACTERS[0].id;
  }

  function initRefreshButton(currentId) {
    const refreshBtn = el('refreshBtn');
    if (!refreshBtn) return;
    refreshBtn.addEventListener('click', () => refreshCharacter(currentId));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const startId = resolveStartId();
    initRefreshButton(startId);
    initTabs();
    initTabNavIndicator();
    initSimpleNavIndicator();
    initViewToggleIcon();
    initRestButtons();
    loadCharacter(startId);
  });
})();