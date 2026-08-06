/* ============================================================
   Wayfarer's Ledger — Campaign Manager
   All data lives in localStorage under STORAGE_KEY.
   No backend required — everything runs in this one browser.
   ============================================================ */

const STORAGE_KEY = 'wayfarers-ledger-data-v1';

/* ============================================================
   SUPABASE — CDN client (no build step)
   The @supabase/supabase-js@2 UMD bundle exposes a global
   `supabase` object with a `.createClient()` factory. We alias
   our client instance to `sb` so it doesn't collide with that
   global.
   ============================================================ */
const SUPABASE_URL = 'https://uwyvdwswiytjhpfvvztn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9u3Ywuu9a_1ntmL0Xj0tYw_lXelpmge';
let sb = null;
try {
   sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
   // The @supabase/supabase-js CDN script didn't load (offline, blocked
   // request, ad-blocker, etc). Without this guard that ReferenceError
   // would stop this whole file from running — including the nav, the
   // mobile menu, and every render() call — leaving a blank-looking page.
   console.error('Supabase client failed to initialize — cloud sync is disabled, local data still works.', err);
}

const AVATAR_BUCKET = 'avatars';
const CHARACTERS_TABLE = 'characters';

/* ---------- Storage: upload a portrait File, return its public URL ---------- */
async function uploadPortraitImage(file) {
   try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadError } = await sb.storage
         .from(AVATAR_BUCKET)
         .upload(path, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: publicData } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      if (!publicData || !publicData.publicUrl) throw new Error('No public URL returned');

      return publicData.publicUrl;
   } catch (err) {
      console.error('Portrait upload failed:', err);
      toast('Upload failed — check your connection and try again');
      return null;
   }
}

/* ---------- DB: insert a new character row, return the saved row ---------- */
async function insertCharacterRemote(character) {
   try {
      const { data: rows, error } = await sb
         .from(CHARACTERS_TABLE)
         .insert([characterToRow(character)])
         .select();

      if (error) throw error;
      return rows[0];
   } catch (err) {
      console.error('Insert character failed:', err);
      toast('Could not save character to the cloud — try again');
      return null;
   }
}

/* Map the app's character object onto the Supabase column names */
function characterToRow(c) {
   return {
      name: c.name,
      player_name: c.playerName || null,
      age: c.age || null,
      gender_pronouns: c.genderPronouns || null,
      race: c.race || null,
      class: c.charClass || null,
      subclass: c.subclass || null,
      edition: c.edition || '2014',
      background: c.background || null,
      divine_connection: c.divineConnection || null,
      familiar: c.familiar || null,
      effluence: c.effluence || null,
      level: c.level || 1,
      max_hp: c.maxHp || 0,
      current_hp: c.currentHp || 0,
      conditions: c.conditions || null,
      str: c.str || 10,
      dex: c.dex || 10,
      con: c.con || 10,
      int: c.int || 10,
      wis: c.wis || 10,
      cha: c.cha || 10,
      hair: c.hair || null,
      eyes: c.eyes || null,
      skin: c.skin || null,
      build: c.build || null,
      height: c.height || null,
      clothing_style: c.clothingStyle || null,
      persona_outside: c.personaOutside || null,
      persona_inside: c.personaInside || null,
      quirks: c.quirks || null,
      voice_mannerisms: c.voiceMannerisms || null,
      daily_habits: c.dailyHabits || null,
      short_term_goals: c.shortTermGoals || null,
      long_term_goals: c.longTermGoals || null,
      stakes: c.stakes || null,
      backstory: c.backstory || null,
      motivation_for_joining: c.motivationForJoining || null,
      group_role: c.groupRole || null,
      portrait_url: c.photo || null
   };
}

/* ---------- DB: update an existing character row, return the saved row ---------- */
async function updateCharacterRemote(id, character) {
   try {
      const { data: rows, error } = await sb
         .from(CHARACTERS_TABLE)
         .update(characterToRow(character))
         .eq('id', id)
         .select();

      if (error) throw error;
      return rows[0];
   } catch (err) {
      console.error('Update character failed:', err);
      toast('Could not update character in the cloud — try again');
      return null;
   }
}

/* ---------- DB: delete a row by id from any table ---------- */
async function deleteRemote(table, id) {
   try {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
   } catch (err) {
      console.error(`Delete from ${table} failed:`, err);
      toast('Could not delete from the cloud — try again');
   }
}

/* ── Generic fetch helper ── */
async function fetchAll(table, order = 'created_at') {
   try {
      let q = sb.from(table).select('*');
      if (order) q = q.order(order, { ascending: true });
      const { data: rows, error } = await q;
      if (error) throw error;
      return rows || [];
   } catch (err) {
      console.error(`Fetch ${table} failed:`, err);
      return null;
   }
}

/* ── Generic upsert helper (insert or update by id) ── */
async function upsertRemote(table, record) {
   try {
      const { error } = await sb.from(table).upsert([record], { onConflict: 'id' });
      if (error) throw error;
   } catch (err) {
      console.error(`Upsert ${table} failed:`, err);
      toast('Could not save to the cloud — try again');
   }
}

/* ── Update the single treasury gold row (creates it if missing) ── */
async function syncGoldRemote(gold) {
   try {
      // Try to find the existing row
      const { data: rows } = await sb.from('treasury').select('id').limit(1);
      if (rows && rows.length) {
         await sb.from('treasury').update({ gold }).eq('id', rows[0].id);
      } else {
         await sb.from('treasury').insert([{ gold }]);
      }
   } catch (err) {
      console.error('Sync gold failed:', err);
   }
}

/* ── Pull HP + ability scores from the dndbeyond_cache and overlay them
      onto the matching character objects so the Characters tab always
      shows live D&D Beyond values rather than manually-entered ones.

      The stat computation below is a direct port of the same functions
      in dnd-sheet.js (sumModifiers / abilityScore / hitPoints) so the
      numbers are always identical to what the character sheet shows. ── */
async function syncStatsFromCache() {
   // Build the list of D&D Beyond IDs we care about from the existing map.
   const nameToId = DND_SHEET_IDS; // { lyon:'168724653', ... }
   const ids = Object.values(nameToId);
   if (!ids.length) return;

   try {
      const { data: rows, error } = await sb
         .from('dndbeyond_cache')
         .select('character_id, payload')
         .in('character_id', ids);
      if (error) throw error;
      if (!rows || !rows.length) return;

      const cacheById = {};
      rows.forEach(r => { cacheById[r.character_id] = r.payload; });

      // ---- Ported stat helpers (same logic as dnd-sheet.js) ----
      const ABILITY_FULL_NAMES = ['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];

      function ddbSumModifiers(charData, type, subType) {
         const groups = (charData.modifiers && Object.values(charData.modifiers)) || [];
         let total = 0;
         groups.forEach(list => {
            (list || []).forEach(m => {
               if (m.type !== type) return;
               if (subType && m.subType !== subType) return;
               if (m.isGranted === false) return;
               total += m.value || 0;
            });
         });
         return total;
      }

      function ddbAbilityScore(charData, index) {
         const statId = index + 1;
         const base  = ((charData.stats        || []).find(s => s.id === statId) || {}).value || 10;
         const bonus = ((charData.bonusStats   || []).find(s => s.id === statId) || {}).value || 0;
         const over  = ((charData.overrideStats|| []).find(s => s.id === statId) || {}).value;
         const modBonus = ddbSumModifiers(charData, 'bonus', ABILITY_FULL_NAMES[index].toLowerCase() + '-score');
         if (over != null) return over;
         return base + bonus + modBonus;
      }

      function ddbTotalLevel(charData) {
         return (charData.classes || []).reduce((s, c) => s + (c.level || 0), 0) || 1;
      }

      function ddbMod(score) { return Math.floor((score - 10) / 2); }

      function ddbHitPoints(charData, scores) {
         if (typeof charData.overrideHitPoints === 'number') {
            const max = charData.overrideHitPoints;
            const removed = charData.removedHitPoints || 0;
            return { max, current: Math.max(0, max - removed) };
         }
         const base    = charData.baseHitPoints || 0;
         const level   = ddbTotalLevel(charData);
         const conBonus     = ddbMod(scores[2]) * level;
         const bonusPerLvl  = ddbSumModifiers(charData, 'bonus', 'hit-points-per-level') * level;
         const flatBonus    = ddbSumModifiers(charData, 'bonus', 'hit-points');
         const max = base + conBonus + bonusPerLvl + flatBonus + (charData.bonusHitPoints || 0);
         const removed = charData.removedHitPoints || 0;
         return { max, current: Math.max(0, max - removed) };
      }
      // ---- End ported helpers ----

      const updates = []; // Supabase update promises, one per matched character

      data.characters.forEach(c => {
         const key = (c.name || '').trim().toLowerCase().split(' ')[0];
         const ddbId = nameToId[key];
         if (!ddbId || !cacheById[ddbId]) return;

         const payload = cacheById[ddbId];
         const cd = payload.data ? payload.data : payload; // unwrap {data:{...}} envelope

         const scores = [0,1,2,3,4,5].map(i => ddbAbilityScore(cd, i));
         const hp     = ddbHitPoints(cd, scores);
         const level  = ddbTotalLevel(cd);

         c.str      = scores[0];
         c.dex      = scores[1];
         c.con      = scores[2];
         c.int      = scores[3];
         c.wis      = scores[4];
         c.cha      = scores[5];
         c.maxHp    = hp.max;
         c.currentHp = hp.current;
         c.level    = level;
         // Portrait: D&D Beyond stores the avatar under decorations.avatarUrl.
         // Only overwrite if the payload actually has one — keep any manually
         // uploaded photo if D&D Beyond returns nothing.
         const ddbAvatar = cd.decorations && cd.decorations.avatarUrl;
         if (ddbAvatar) c.photo = ddbAvatar;

         // Queue a Supabase write — runs in parallel below.
         updates.push(updateCharacterRemote(c.id, c));
      });

      if (updates.length) {
         saveData();
         render();
         // Write all patched characters back to Supabase in parallel.
         await Promise.all(updates);
      }
   } catch (err) {
      console.error('syncStatsFromCache failed:', err);
   }
}

/* ---------- DB: fetch every character row, oldest first ---------- */
async function fetchAllCharactersRemote() {
   try {
      const { data: rows, error } = await sb
         .from(CHARACTERS_TABLE)
         .select('*')
         .order('created_at', { ascending: true });

      if (error) throw error;
      return rows || [];
   } catch (err) {
      console.error('Fetch characters failed:', err);
      toast('Could not load characters — showing local data only');
      return null; // null (vs []) distinguishes "network failed" from "table is empty"
   }
}

/* Map a Supabase characters row onto the shape the rest of the UI expects. */
function remoteRowToCharacter(row) {
   return Object.assign({}, CHAR_DEFAULTS, {
      id: row.id,
      name: row.name || '',
      playerName: row.player_name || '',
      age: row.age || '',
      genderPronouns: row.gender_pronouns || '',
      race: row.race || '',
      charClass: row.class || '',
      subclass: row.subclass || '',
      edition: row.edition || '2014',
      background: row.background || '',
      divineConnection: row.divine_connection || '',
      familiar: row.familiar || '',
      effluence: row.effluence || '',
      level: row.level || 1,
      maxHp: row.max_hp || 0,
      currentHp: row.current_hp || 0,
      conditions: row.conditions || '',
      str: row.str || 10,
      dex: row.dex || 10,
      con: row.con || 10,
      int: row.int || 10,
      wis: row.wis || 10,
      cha: row.cha || 10,
      hair: row.hair || '',
      eyes: row.eyes || '',
      skin: row.skin || '',
      build: row.build || '',
      height: row.height || '',
      clothingStyle: row.clothing_style || '',
      personaOutside: row.persona_outside || '',
      personaInside: row.persona_inside || '',
      quirks: row.quirks || '',
      voiceMannerisms: row.voice_mannerisms || '',
      dailyHabits: row.daily_habits || '',
      shortTermGoals: row.short_term_goals || '',
      longTermGoals: row.long_term_goals || '',
      stakes: row.stakes || '',
      backstory: row.backstory || '',
      motivationForJoining: row.motivation_for_joining || '',
      groupRole: row.group_role || '',
      photo: row.portrait_url || null
   });
}

const ICON_ARROW = '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const ICON_COMPASS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
const ICON_USER = '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const ICON_NPC = '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-3-3.87"/><path d="M7 21v-2a4 4 0 0 1 4-4h0"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const ICON_EXTERNAL = '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
// Document / sheet icon — folded top-right corner, three content lines
const ICON_SHEET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/></svg>';

/* ---------- Local dnd-sheet.html IDs, keyed by character first name (lowercase) ---------- */
/* IDs must match KNOWN_CHARACTERS in dnd-sheet.js */
const DND_SHEET_IDS = {
   lyon:   '168724653',
   luna:   '168259462',
   syrena: '168259436',
   khalen: '168222335',
   vigi:   '168259911'
};
function dndLocalSheetFor(name, charClass) {
   const key = (name || '').trim().toLowerCase().split(' ')[0];
   const id = DND_SHEET_IDS[key];
   if (!id) return null;
   // name/class ride along so the sheet's loading splash already knows
   // who/what it's loading (theme color + name) before it ever hits
   // Supabase or D&D Beyond — see primeLoaderForCharacter() in dnd-sheet.js.
   const params = new URLSearchParams({ id });
   if (name) params.set('name', name);
   if (charClass) params.set('class', charClass);
   return `dnd-sheet.html?${params.toString()}`;
}
const ICON_COINS = '<svg viewBox="0 0 401.601 401.6"><defs><linearGradient id="coinGoldGrad" gradientUnits="userSpaceOnUse" x1="-400" y1="200" x2="400" y2="200"><stop offset="0" stop-color="var(--accent-gold)"/><stop offset="0.35" stop-color="var(--accent-gold)"/><stop offset="0.5" stop-color="#EBD48A"/><stop offset="0.65" stop-color="var(--accent-gold)"/><stop offset="1" stop-color="var(--accent-gold)"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="800 0" dur="5s" repeatCount="indefinite"/></linearGradient></defs><g fill="url(#coinGoldGrad)"><path d="M116.682,229.329c11.286,0,22.195-0.729,32.518-2.086V114.094c-10.322-1.356-21.232-2.085-32.518-2.085 c-64.441,0-116.681,23.693-116.681,52.921v11.477C0.001,205.634,52.241,229.329,116.682,229.329z"/><path d="M116.682,288.411c11.286,0,22.195-0.729,32.518-2.084v-33.166c-10.325,1.356-21.229,2.095-32.518,2.095 c-56.25,0-103.199-18.054-114.227-42.082c-1.606,3.5-2.454,7.124-2.454,10.839v11.477 C0.001,264.718,52.241,288.411,116.682,288.411z"/><path d="M149.199,314.823v-2.578c-10.325,1.356-21.229,2.095-32.518,2.095c-56.25,0-103.199-18.054-114.227-42.082 C0.848,275.757,0,279.381,0,283.096v11.477c0,29.229,52.24,52.922,116.681,52.922c12.887,0,25.282-0.95,36.873-2.7 c-2.873-5.877-4.355-12.075-4.355-18.496V314.823z"/><path d="M284.92,22.379c-64.441,0-116.681,23.693-116.681,52.921v11.477c0,29.228,52.24,52.921,116.681,52.921 c64.44,0,116.681-23.693,116.681-52.921V75.3C401.601,46.072,349.36,22.379,284.92,22.379z"/><path d="M284.92,165.626c-56.25,0-103.199-18.053-114.227-42.082c-1.606,3.499-2.454,7.123-2.454,10.839v11.477 c0,29.228,52.24,52.921,116.681,52.921c64.44,0,116.681-23.693,116.681-52.921v-11.477c0-3.716-0.848-7.34-2.454-10.839 C388.119,147.573,341.17,165.626,284.92,165.626z"/><path d="M284.92,224.71c-56.25,0-103.199-18.054-114.227-42.082c-1.606,3.499-2.454,7.123-2.454,10.839v11.477 c0,29.229,52.24,52.922,116.681,52.922c64.44,0,116.681-23.693,116.681-52.922v-11.477c0-3.716-0.848-7.34-2.454-10.839 C388.119,206.657,341.17,224.71,284.92,224.71z"/><path d="M284.92,286.983c-56.25,0-103.199-18.054-114.227-42.082c-1.606,3.5-2.454,7.123-2.454,10.838v11.478 c0,29.228,52.24,52.921,116.681,52.921c64.44,0,116.681-23.693,116.681-52.921v-11.478c0-3.715-0.848-7.34-2.454-10.838 C388.119,268.928,341.17,286.983,284.92,286.983z"/><path d="M284.92,346.066c-56.25,0-103.199-18.053-114.227-42.081c-1.606,3.5-2.454,7.125-2.454,10.838V326.3 c0,29.228,52.24,52.921,116.681,52.921c64.44,0,116.681-23.693,116.681-52.921v-11.478c0-3.715-0.848-7.34-2.454-10.838 C388.119,328.012,341.17,346.066,284.92,346.066z"/></g></svg>';

/* ---------- D&D classes, subclasses (by edition) & visual tokens ---------- */
const CLASS_META = {
   Barbarian: {
      color: '#8a3324', icon: '<img src="images/class icons/Class_Icon_-_Barbarian.svg" alt="Barbarian" class="class-icon-img">',
      subclasses: {
         '2014': ['Path of the Berserker', 'Path of the Totem Warrior'],
         '2024': ['Path of the Berserker', 'Path of the Wild Heart', 'Path of the World Tree', 'Path of the Zealot']
      }
   },
   Bard: {
      color: '#7a4f9e', icon: '<img src="images/class icons/Class_Icon_-_Bard.svg" alt="Bard" class="class-icon-img">',
      subclasses: {
         '2014': ['College of Lore', 'College of Valor'],
         '2024': ['College of Dance', 'College of Glamour', 'College of Lore', 'College of Valor']
      }
   },
   Cleric: {
      color: '#c9a227', icon: '<img src="images/class icons/Class_Icon_-_Cleric.svg" alt="Cleric" class="class-icon-img">',
      subclasses: {
         '2014': ['Knowledge Domain', 'Life Domain', 'Light Domain', 'Nature Domain', 'Tempest Domain', 'Trickery Domain', 'War Domain'],
         '2024': ['Life Domain', 'Light Domain', 'Trickery Domain', 'War Domain']
      }
   },
   Druid: {
      color: '#4f7942', icon: '<img src="images/class icons/Class_Icon_-_Druid.svg" alt="Druid" class="class-icon-img">',
      subclasses: {
         '2014': ['Circle of the Land', 'Circle of the Moon'],
         '2024': ['Circle of the Land', 'Circle of the Moon', 'Circle of the Sea', 'Circle of the Stars']
      }
   },
   Fighter: {
      color: '#5a5a5a', icon: '<img src="images/class icons/Class_Icon_-_Fighter.svg" alt="Fighter" class="class-icon-img">',
      subclasses: {
         '2014': ['Battle Master', 'Champion', 'Eldritch Knight'],
         '2024': ['Battle Master', 'Champion', 'Eldritch Knight', 'Psi Warrior']
      }
   },
   Monk: {
      color: '#b5651d', icon: '<img src="images/class icons/Class_Icon_-_Monk.svg" alt="Monk" class="class-icon-img">',
      subclasses: {
         '2014': ['Way of the Open Hand', 'Way of Shadow', 'Way of the Four Elements'],
         '2024': ['Warrior of Mercy', 'Warrior of Shadow', 'Warrior of the Elements', 'Warrior of the Open Hand']
      }
   },
   Paladin: {
      color: '#c0a668', icon: '<img src="images/class icons/Class_Icon_-_Paladin.svg" alt="Paladin" class="class-icon-img">',
      subclasses: {
         '2014': ['Oath of Devotion', 'Oath of the Ancients', 'Oath of Vengeance'],
         '2024': ['Oath of Devotion', 'Oath of Glory', 'Oath of the Ancients', 'Oath of Vengeance']
      }
   },
   Ranger: {
      color: '#2f6f4f', icon: '<img src="images/class icons/Class_Icon_-_Ranger.svg" alt="Ranger" class="class-icon-img">',
      subclasses: {
         '2014': ['Beast Master', 'Hunter'],
         '2024': ['Beast Master', 'Fey Wanderer', 'Gloom Stalker', 'Hunter']
      }
   },
   Rogue: {
      color: '#2b2b2b', icon: '<img src="images/class icons/Class_Icon_-_Rogue.svg" alt="Rogue" class="class-icon-img">',
      subclasses: {
         '2014': ['Arcane Trickster', 'Assassin', 'Thief'],
         '2024': ['Arcane Trickster', 'Assassin', 'Soulknife', 'Thief']
      }
   },
   Sorcerer: {
      color: '#a63d3d', icon: '<img src="images/class icons/Class_Icon_-_Sorcerer.svg" alt="Sorcerer" class="class-icon-img">',
      subclasses: {
         '2014': ['Draconic Bloodline', 'Wild Magic'],
         '2024': ['Aberrant Sorcery', 'Clockwork Sorcery', 'Draconic Sorcery', 'Wild Magic Sorcery']
      }
   },
   Warlock: {
      color: '#5b3a7a', icon: '<img src="images/class icons/Class_Icon_-_Warlock.svg" alt="Warlock" class="class-icon-img">',
      subclasses: {
         '2014': ['The Archfey', 'The Fiend', 'The Great Old One'],
         '2024': ['Archfey Patron', 'Celestial Patron', 'Fiend Patron', 'Great Old One Patron']
      }
   },
   Wizard: {
      color: '#2f4f6f', icon: '<img src="images/class icons/Class_Icon_-_Wizard.svg" alt="Wizard" class="class-icon-img">',
      subclasses: {
         '2014': ['School of Abjuration', 'School of Conjuration', 'School of Divination', 'School of Enchantment', 'School of Evocation', 'School of Illusion', 'School of Necromancy', 'School of Transmutation'],
         '2024': ['Abjurer', 'Diviner', 'Evoker', 'Illusionist']
      }
   }
};
const CLASS_ORDER = Object.keys(CLASS_META);
const CLASS_DEFAULT_META = { color: '#9c9284', icon: ICON_COMPASS };

function classMeta(charClass) {
   return CLASS_META[charClass] || CLASS_DEFAULT_META;
}

function classOptionsHTML(current) {
   const opts = CLASS_ORDER.slice();
   if (current && !opts.includes(current)) opts.unshift(current);
   return `<option value="">— Select —</option>` + opts.map(cl =>
      `<option value="${escapeHTML(cl)}" ${cl === current ? 'selected' : ''}>${escapeHTML(cl)}</option>`).join('');
}

function subclassOptionsHTML(charClass, edition, current) {
   const meta = CLASS_META[charClass];
   const list = meta ? (meta.subclasses[edition] || []) : [];
   const opts = list.slice();
   if (current && !opts.includes(current)) opts.unshift(current);
   if (!opts.length) return `<option value="">—</option>`;
   return `<option value="">— Select —</option>` + opts.map(s =>
      `<option value="${escapeHTML(s)}" ${s === current ? 'selected' : ''}>${escapeHTML(s)}</option>`).join('');
}

/* Circular portrait/token. size in px. withBadge adds a small class-icon
   badge that pops out over the edge of the circle — used for both an
   uploaded photo and the plain class-colored circle shown without one. */
function avatarHTML(c, size, withBadge, large) {
   const meta = classMeta(c.charClass);
   const cls = `char-avatar${large ? ' char-avatar-lg' : ''}`;
   const badge = withBadge ? `<span class="char-avatar-badge" style="background:${meta.color}">${meta.icon}</span>` : '';
   if (c.photo) {
      return `<div class="${cls}" style="width:${size}px;height:${size}px;border-color:${meta.color}">
			<img src="${c.photo}" alt="${escapeHTML(c.name)}">${badge}
		</div>`;
   }
   return `<div class="${cls} char-avatar-empty" style="width:${size}px;height:${size}px;background:${meta.color};border-color:${meta.color}">${badge}</div>`;
}

/* Same circular portrait treatment as avatarHTML, but for NPCs — no
   class color or badge, just a photo or a plain silhouette. */
function npcAvatarHTML(n, size, large) {
   const cls = `char-avatar npc-avatar${large ? ' char-avatar-lg' : ''}`;
   if (n.photo) {
      return `<div class="${cls}" style="width:${size}px;height:${size}px;">
			<img src="${n.photo}" alt="${escapeHTML(n.name)}">
		</div>`;
   }
   return `<div class="${cls} char-avatar-empty npc-avatar-empty" style="width:${size}px;height:${size}px;">${ICON_USER}</div>`;
}

/* ---------- Seed data (shown the first time you open the app) ---------- */
function seedData() {
   const now = Date.now();
   return {
      characters: [
         {
            id: 'c1', name: 'Aeryn Voss', playerName: 'Sam', race: 'Half-Elf', charClass: 'Ranger',
            level: 5, maxHp: 44, currentHp: 44, conditions: '',
            str: 13, dex: 18, con: 14, int: 10, wis: 15, cha: 8,
            backstory: 'Raised on the border of the Thornwood, Aeryn tracks what others cannot see. Joined the party after the ambush at Millbrook Crossing.'
         }
      ],
      npcs: [
         {
            id: 'n1', name: 'Magistrate Orin Dell', location: 'Millbrook', affiliation: 'Town Council',
            notes: 'Owes the party a favor after the bandit raid. Nervous, easily bribed, hates the Ashen Hand.'
         }
      ],
      lore: [
         {
            id: 'l1', title: 'The Ashen Hand', category: 'Faction',
            content: 'A secretive cult worshipping a fallen god of embers. Operates through blackmail and small fires that are never accidents.'
         }
      ],
      quests: [
         {
            id: 'q1', title: 'The Millbrook Ambush', status: 'Active',
            description: 'Investigate who hired the bandits that attacked the trade caravan outside Millbrook.',
            reward: '250 gp, favor from Magistrate Dell'
         }
      ],
      sessions: [
         {
            id: 's1', date: new Date(now).toISOString().slice(0, 10), title: 'Session 1 — Ashes on the Road',
            recap: 'The party arrived in Millbrook to find the trade road under attack. After driving off the bandits, they discovered a burnt sigil at the campsite matching no known heraldry.'
         }
      ],
      treasury: {
         gold: 250,
         loot: [
            { id: 't1', name: 'Sigil of Cold Iron', value: 0, description: 'Recovered from the bandit camp. Warm to the touch. Unidentified.' }
         ],
         log: [
            { id: 'g1', date: new Date(now).toISOString().slice(0, 10), change: 250, note: 'Starting party funds' }
         ]
      },
      rules: [
         {
            id: 'r1', title: 'Inspiration Dice', content: 'Instead of advantage, spend inspiration to roll a d4 and add it to any roll. Refreshes on a long rest, max 2 stored.'
         }
      ]
   };
}

function loadData() {
   try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
         const seeded = seedData();
         localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
         return seeded;
      }
      return JSON.parse(raw);
   } catch (e) {
      console.error('Failed to load data, reseeding.', e);
      const seeded = seedData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
   }
}

function saveData() {
   localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
   flashStatus('Saved');
}

function uid() {
   // Use the browser's built-in UUID generator so ids match Supabase's uuid column type
   return crypto.randomUUID();
}

/* Resize + convert an uploaded image file to a compact base64 JPEG,
   so portrait photos don't blow up localStorage's size limit. */
function readImageAsDataURL(file, maxDim = 500) {
   return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
         const img = new Image();
         img.onload = () => {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
               if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
               else { width = Math.round(width * maxDim / height); height = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
         };
         img.onerror = reject;
         img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
   });
}

/* ---------- Global state ---------- */
let data = loadData();
const VALID_SECTIONS = ['dashboard', 'characters', 'npcs', 'lore', 'quests', 'sessions', 'treasury', 'rules'];
const LAST_SECTION_KEY = 'wayfarers-ledger-last-section';
const LAST_SELECTED_CHAR_KEY = 'wayfarers-ledger-last-char';
const LAST_MOBILE_DETAIL_KEY = 'wayfarers-ledger-mobile-detail';
const savedSection = localStorage.getItem(LAST_SECTION_KEY);
const savedCharId = localStorage.getItem(LAST_SELECTED_CHAR_KEY);
const savedMobileDetail = localStorage.getItem(LAST_MOBILE_DETAIL_KEY) === '1';

let state = {
   section: VALID_SECTIONS.includes(savedSection) ? savedSection : 'dashboard',
   selectedId: savedCharId ? { characters: savedCharId } : {}, // restored from last session
   search: {},
   filter: {}
};

const leftSide = document.getElementById('leftSide');
const canvasSide = document.getElementById('canvasSide');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');
const footerStatus = document.getElementById('footerStatus');
const splitContainer = document.querySelector('.split-container');
const siteHeader = document.querySelector('.site-header');
const siteNav = document.getElementById('siteNav');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');
const mobileBackBtn = document.getElementById('mobileBackBtn');

/* ---------- Toast / status ---------- */
let statusTimer = null;
function flashStatus(msg) {
   footerStatus.textContent = msg;
   clearTimeout(statusTimer);
   statusTimer = setTimeout(() => {
      footerStatus.textContent = 'Data saved locally in this browser';
   }, 2000);
}

function toast(msg) {
   const el = document.createElement('div');
   el.className = 'toast';
   el.textContent = msg;
   toastRoot.appendChild(el);
   setTimeout(() => el.remove(), 2600);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const navLinks = document.querySelectorAll('[data-nav]');
navLinks.forEach(link => {
   link.addEventListener('click', (e) => {
      e.preventDefault();
      switchSection(link.dataset.nav);
   });
});

function switchSection(section) {
   state.section = section;
   localStorage.setItem(LAST_SECTION_KEY, section);
   navLinks.forEach(l => l.classList.toggle('nav-active', l.dataset.nav === section));
   settleNavIndicator();
   splitContainer.classList.toggle('list-detail-mode', section !== 'dashboard');
   hideMobileDetail();
   closeMobileNav();
   render();
}

/* ── Fluid nav indicator: glides to whatever tab is hovered,
   settles back onto the active tab once the pointer leaves. ── */
const navBar = document.querySelector('.site-header-nav');
const navIndicator = document.getElementById('navIndicator');
const tabLinks = document.querySelectorAll('.site-header-nav a[data-nav]');

function moveNavIndicatorTo(link) {
   if (!navIndicator || !link) return;
   if (isMobileViewport()) return; // mobile highlight is plain CSS on .nav-active — nothing to compute or toggle here
   tabLinks.forEach(t => t.classList.toggle('nav-lit', t === link));
   const barRect = navBar.getBoundingClientRect();
   const linkRect = link.getBoundingClientRect();
   navIndicator.style.top = '0px';
   navIndicator.style.left = (linkRect.left - barRect.left) + 'px';
   navIndicator.style.height = '100%';
   navIndicator.style.width = linkRect.width + 'px';
   navIndicator.style.opacity = '1';
}

function settleNavIndicator() {
   const active = document.querySelector('.site-header-nav a.nav-active');
   if (active) {
      moveNavIndicatorTo(active);
   } else if (navIndicator) {
      navIndicator.style.opacity = '0';
      tabLinks.forEach(t => t.classList.remove('nav-lit'));
   }
}

if (navBar && navIndicator) {
   tabLinks.forEach(link => {
      link.addEventListener('mouseenter', () => {
         if (isMobileViewport()) return; // no real hover on touch — avoid phantom taps stealing the pill
         moveNavIndicatorTo(link);
      });
   });
   navBar.addEventListener('mouseleave', () => {
      if (isMobileViewport()) return;
      settleNavIndicator();
   });
   window.addEventListener('resize', settleNavIndicator);
   if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(settleNavIndicator);
   }
}

/* ============================================================
   MOBILE UI — hamburger nav + master/detail navigation
   On narrow screens the list and its detail view are shown as
   separate "screens": tapping a row slides in the detail view
   with a Back button, instead of stacking both on one long page.
   ============================================================ */
function isMobileViewport() {
   return window.matchMedia('(max-width: 900px)').matches;
}

/* Keep a --header-h custom property in sync with the real header
   height so the nav dropdown and back-button bar line up under it
   even as the title wraps or fonts finish loading. */
function updateHeaderHeightVar() {
   if (!siteHeader) return;
   document.documentElement.style.setProperty('--header-h', siteHeader.getBoundingClientRect().height + 'px');
}

function openMobileNav() {
   if (!siteNav) return;
   siteNav.classList.add('nav-open');
   if (mobileNavBackdrop) mobileNavBackdrop.classList.add('open');
   if (mobileNavToggle) mobileNavToggle.setAttribute('aria-expanded', 'true');
   settleNavIndicator();
}

function closeMobileNav() {
   if (!siteNav) return;
   siteNav.classList.remove('nav-open');
   if (mobileNavBackdrop) mobileNavBackdrop.classList.remove('open');
   if (mobileNavToggle) mobileNavToggle.setAttribute('aria-expanded', 'false');
}

function toggleMobileNav() {
   if (siteNav && siteNav.classList.contains('nav-open')) closeMobileNav();
   else openMobileNav();
}

function showMobileDetail() {
   if (!isMobileViewport()) return;
   splitContainer.classList.add('mobile-detail-view');
   localStorage.setItem(LAST_MOBILE_DETAIL_KEY, '1');
   window.scrollTo({ top: 0 });
}

function hideMobileDetail() {
   splitContainer.classList.remove('mobile-detail-view');
   localStorage.removeItem(LAST_MOBILE_DETAIL_KEY);
   window.scrollTo({ top: 0 });
}

if (mobileNavToggle) mobileNavToggle.addEventListener('click', toggleMobileNav);
if (mobileNavBackdrop) mobileNavBackdrop.addEventListener('click', closeMobileNav);
if (mobileBackBtn) mobileBackBtn.addEventListener('click', hideMobileDetail);

document.addEventListener('keydown', (e) => {
   if (e.key === 'Escape') closeMobileNav();
});

/* leftSide itself is never replaced (only its innerHTML is), so one
   delegated listener here keeps working across every re-render. */
leftSide.addEventListener('click', (e) => {
   if (e.target.closest('.entry-item')) showMobileDetail();
});

window.addEventListener('resize', () => {
   updateHeaderHeightVar();
   if (!isMobileViewport()) {
      closeMobileNav();
      hideMobileDetail();
   }
});
updateHeaderHeightVar();
if (document.fonts && document.fonts.ready) {
   document.fonts.ready.then(updateHeaderHeightVar);
}

/* ============================================================
   RENDER DISPATCH
   ============================================================ */
function render() {
   switch (state.section) {
      case 'dashboard': return renderDashboard();
      case 'characters': return renderCharacters();
      case 'npcs': return renderNPCs();
      case 'lore': return renderLore();
      case 'quests': return renderQuests();
      case 'sessions': return renderSessions();
      case 'treasury': return renderTreasury();
      case 'rules': return renderRules();
   }
}

/* ---------- Shared: empty canvas placeholder ---------- */
function placeholderHTML(text) {
   return `<div class="canvas-placeholder">
		<div class="placeholder-icon">${ICON_COMPASS}</div>
		<span class="placeholder-text">${text}</span>
	</div>`;
}

/* ---------- Shared: build an <li class="entry-item"> ---------- */
/* Small edit/trash icon pair placed next to a detail headline.
   Keeps the same #editBtn/#deleteBtn ids each detail-render function
   already wires up click handlers for. */
function headlineIconsHTML(editId = 'editBtn', deleteId = 'deleteBtn') {
   return `<div class="headline-row-icons">
		<span class="headline-icon-btn" id="${editId}" title="Edit">${ICON_EDIT}</span>
		<span class="headline-icon-btn headline-icon-danger" id="${deleteId}" title="Delete">${ICON_TRASH}</span>
	</div>`;
}

// Wraps the sheet link + edit/delete icons in a grouped container so they
// can sit below the character name as a unit on mobile.
function headlineIconsGroupHTML(sheetLinkHTML, editId = 'editBtn', deleteId = 'deleteBtn') {
   return `<div class="headline-row-icons">${sheetLinkHTML ? sheetLinkHTML : ''}<span class="headline-icon-btn" id="${editId}" title="Edit">${ICON_EDIT}</span><span class="headline-icon-btn headline-icon-danger" id="${deleteId}" title="Delete">${ICON_TRASH}</span></div>`;
}

function entryItem(id, section, title, meta, isActive) {
   return `<li class="entry-item ${isActive ? 'active' : ''}" data-id="${id}">
		<div class="entry-link">
			<span class="entry-title">${escapeHTML(title)}</span>
			${meta ? `<span class="entry-meta">${meta}</span>` : ''}
			<span class="entry-arrow">${ICON_ARROW}</span>
		</div>
	</li>`;
}

function escapeHTML(str) {
   if (str === undefined || str === null) return '';
   return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nl2br(str) {
   return escapeHTML(str).replace(/\n/g, '<br>');
}

/* ============================================================
   DASHBOARD
   ============================================================ */
/* Compact roster row: avatar, name/class/level, and a mini HP bar —
   reuses the same avatarHTML() and HP-color thresholds as the
   character detail view so the dashboard preview matches. */
function partyRosterItemHTML(c) {
   const maxHp = Number(c.maxHp) || 0;
   const currentHp = Number.isFinite(c.currentHp) ? c.currentHp : maxHp;
   const hpPct = maxHp ? Math.max(0, Math.min(100, Math.round((currentHp / maxHp) * 100))) : 100;
   const hpState = hpPct <= 25 ? 'critical' : hpPct <= 50 ? 'low' : '';
   const subline = [c.race, c.charClass].filter(Boolean).join(' ') + (c.level ? ` · Lv ${c.level}` : '');
   return `<li class="party-roster-item" data-id="${c.id}">
		${avatarHTML(c, 44, true)}
		<div class="party-roster-info">
			<span class="party-roster-name">${escapeHTML(c.name)}</span>
			<span class="party-roster-meta">${escapeHTML(subline)}</span>
		</div>
		<div class="party-roster-hp">
			<div class="hp-track"><div class="hp-fill ${hpState}" style="width:${hpPct}%"></div></div>
			<span class="hp-text">${currentHp}/${maxHp || '—'}</span>
		</div>
	</li>`;
}

function renderDashboard() {
   const latestSession = [...data.sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
   const activeQuests = data.quests.filter(q => q.status === 'Active');
   const completedQuests = data.quests.filter(q => q.status !== 'Active');
   const recentLoot = [...data.treasury.loot].slice(-4).reverse();
   const recentLog = [...data.treasury.log].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
   const spotlightNpcs = data.npcs.slice(0, 4);
   const featuredLore = data.lore[data.lore.length - 1];
   const latestRule = data.rules[data.rules.length - 1];

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">Campaign Overview</span>
				<h1 class="section-title">Dashboard</h1>
			</div>
		</div>
		<div class="toolbar" style="padding-bottom: 1.2rem;">
			<div class="stat-strip">
				<div class="stat-card"><span class="stat-icon-wrap"><span class="stat-icon">${ICON_USER}</span></span><div class="stat-card-info"><span class="stat-number">${data.characters.length}</span><span class="stat-label">Characters</span></div></div>
				<div class="stat-card"><span class="stat-icon-wrap"><span class="stat-icon">${ICON_NPC}</span></span><div class="stat-card-info"><span class="stat-number">${data.npcs.length}</span><span class="stat-label">NPCs</span></div></div>
				<div class="stat-card"><span class="stat-icon-wrap"><span class="stat-icon">${ICON_COMPASS}</span></span><div class="stat-card-info"><span class="stat-number">${activeQuests.length}</span><span class="stat-label">Active Quests</span></div></div>
				<div class="stat-card"><span class="stat-icon-wrap"><span class="stat-icon">${ICON_SHEET}</span></span><div class="stat-card-info"><span class="stat-number">${data.sessions.length}</span><span class="stat-label">Sessions Logged</span></div></div>
				<div class="stat-card"><span class="stat-icon-wrap"><span class="stat-icon">${ICON_COINS}</span></span><div class="stat-card-info"><span class="stat-number">${data.treasury.gold}</span><span class="stat-label">Party Gold</span></div></div>
			</div>
		</div>
		<div class="party-roster-wrap">
			<span class="dashboard-card-label" style="padding: 0 3rem;">The Party</span>
			<ul class="party-roster">
				${data.characters.length
         ? data.characters.map(c => partyRosterItemHTML(c)).join('')
         : `<li class="dashboard-empty" style="padding:0.4rem 3rem 0;">No characters added yet.</li>`}
			</ul>
		</div>
	`;

   canvasSide.innerHTML = `<div class="detail-content" style="width:100%;">
		<div class="dashboard-grid">

			<div class="dashboard-card dashboard-card-wide">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">Latest Session Recap</span>
					<span class="dashboard-card-icon">${ICON_SHEET}</span>
				</div>
				${latestSession ? `
					<h3>${escapeHTML(latestSession.title)}</h3>
					<span class="dashboard-card-date">${escapeHTML(latestSession.date || '')}</span>
					<p>${escapeHTML((latestSession.recap || '').slice(0, 320))}${(latestSession.recap || '').length > 320 ? '…' : ''}</p>
					<div style="margin-top:1rem;"><button class="btn btn-ghost btn-small" id="goToSession">Read Full Recap</button></div>
				` : `<p class="dashboard-empty">No sessions logged yet. Add your first recap in the Sessions tab.</p>`}
			</div>

			<div class="dashboard-card">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">Active Quests</span>
					<span class="dashboard-card-icon">${ICON_COMPASS}</span>
				</div>
				${activeQuests.length ? `
					<ul class="quest-mini-list">
						${activeQuests.slice(0, 5).map(q => `<li data-id="${q.id}"><span>${escapeHTML(q.title)}</span><span class="badge badge-active">Active</span></li>`).join('')}
					</ul>
					${completedQuests.length ? `<span class="dashboard-card-footnote">${completedQuests.length} other quest${completedQuests.length === 1 ? '' : 's'} resolved</span>` : ''}
				` : `<p class="dashboard-empty">No active quests right now. The party has a moment to rest.</p>`}
			</div>

			<div class="dashboard-card">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">Treasury</span>
					<span class="dashboard-card-icon">${ICON_COINS}</span>
				</div>
				<div class="treasury-snapshot">
					<span class="treasury-snapshot-amount">${data.treasury.gold} <small>gp</small></span>
					${recentLog ? `<span class="dashboard-card-footnote">${recentLog.change >= 0 ? '+' : ''}${recentLog.change} gp — ${escapeHTML(recentLog.note || '')}</span>` : ''}
				</div>
				${recentLoot.length ? `
					<ul class="loot-mini-list">
						${recentLoot.map(item => `<li><span>${escapeHTML(item.name)}</span>${item.value ? `<span class="badge badge-side">${item.value} gp</span>` : ''}</li>`).join('')}
					</ul>
				` : `<p class="dashboard-empty">No loot recorded yet.</p>`}
			</div>

			<div class="dashboard-card">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">Notable NPCs</span>
					<span class="dashboard-card-icon">${ICON_NPC}</span>
				</div>
				${spotlightNpcs.length ? `
					<ul class="npc-mini-list">
						${spotlightNpcs.map(n => `<li data-id="${n.id}">
							${npcAvatarHTML(n, 36)}
							<span class="npc-mini-info">
								<span class="npc-mini-name">${escapeHTML(n.name)}</span>
								<span class="npc-mini-meta">${escapeHTML(n.location || n.affiliation || '')}</span>
							</span>
						</li>`).join('')}
					</ul>
				` : `<p class="dashboard-empty">No NPCs logged yet.</p>`}
			</div>

			<div class="dashboard-card">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">World Lore Spotlight</span>
					<span class="dashboard-card-icon">${ICON_COMPASS}</span>
				</div>
				${featuredLore ? `
					<span class="badge badge-side" style="margin-bottom:0.7rem;display:inline-block;">${escapeHTML(featuredLore.category || 'Lore')}</span>
					<h3>${escapeHTML(featuredLore.title)}</h3>
					<p>${escapeHTML((featuredLore.content || '').slice(0, 200))}${(featuredLore.content || '').length > 200 ? '…' : ''}</p>
					<div style="margin-top:1rem;"><button class="btn btn-ghost btn-small" id="goToLore">Read More</button></div>
				` : `<p class="dashboard-empty">No lore entries yet.</p>`}
			</div>

			<div class="dashboard-card">
				<div class="dashboard-card-header">
					<span class="dashboard-card-label">Homebrew Rules</span>
					<span class="dashboard-card-icon">${ICON_SHEET}</span>
				</div>
				${latestRule ? `
					<h3>${escapeHTML(latestRule.title)}</h3>
					<p>${escapeHTML((latestRule.content || '').slice(0, 200))}${(latestRule.content || '').length > 200 ? '…' : ''}</p>
					<span class="dashboard-card-footnote">${data.rules.length} house rule${data.rules.length === 1 ? '' : 's'} on the books</span>
				` : `<p class="dashboard-empty">No homebrew rules yet.</p>`}
			</div>

		</div>
	</div>`;

   if (latestSession) {
      const goBtn = document.getElementById('goToSession');
      if (goBtn) goBtn.addEventListener('click', () => {
         state.selectedId.sessions = latestSession.id;
         switchSection('sessions');
      });
   }
   if (featuredLore) {
      const loreBtn = document.getElementById('goToLore');
      if (loreBtn) loreBtn.addEventListener('click', () => {
         state.selectedId.lore = featuredLore.id;
         switchSection('lore');
      });
   }
   canvasSide.querySelectorAll('.quest-mini-list li').forEach(li => {
      li.addEventListener('click', () => {
         state.selectedId.quests = li.dataset.id;
         switchSection('quests');
      });
   });
   canvasSide.querySelectorAll('.npc-mini-list li').forEach(li => {
      li.addEventListener('click', () => {
         state.selectedId.npcs = li.dataset.id;
         switchSection('npcs');
      });
   });
   leftSide.querySelectorAll('.party-roster-item').forEach(li => {
      li.addEventListener('click', () => {
         state.selectedId.characters = li.dataset.id;
         switchSection('characters');
      });
   });
}

/* ============================================================
   CHARACTERS
   ============================================================ */
function renderCharacters() {
   const list = data.characters;
   const selectedId = state.selectedId.characters || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">Roster</span>
				<h1 class="section-title">Characters</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Character</button>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(c => characterEntryItem(c, c.id === selectedId)).join('')
         : `<li class="empty-state">No characters yet. Add your first PC.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openCharacterModal());
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.characters) return;
         state.selectedId.characters = item.dataset.id;
         localStorage.setItem(LAST_SELECTED_CHAR_KEY, item.dataset.id); // persist across navigation
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderCharacterDetail(item.dataset.id);
      });
   });

   renderCharacterDetail(selectedId);
}

function characterEntryItem(c, isActive) {
   const classColor = classMeta(c.charClass).color;
   return `<li class="entry-item ${isActive ? 'active' : ''}" data-id="${c.id}" style="--char-accent:${classColor};">
		<div class="entry-link">
			${avatarHTML(c, 57, true)}
			<span class="entry-title">${escapeHTML(c.name)}</span>
			<span class="entry-meta">${escapeHTML(c.charClass || '')} · Lv ${c.level || '?'}</span>
			<span class="entry-arrow">${ICON_ARROW}</span>
		</div>
	</li>`;
}

function npcEntryItem(n, isActive) {
   return `<li class="entry-item ${isActive ? 'active' : ''}" data-id="${n.id}">
		<div class="entry-link">
			${npcAvatarHTML(n, 57)}
			<span class="entry-title">${escapeHTML(n.name)}</span>
			<span class="entry-meta">${escapeHTML(n.location || '')}</span>
			<span class="entry-arrow">${ICON_ARROW}</span>
		</div>
	</li>`;
}

function renderCharacterDetail(id) {
   const c = data.characters.find(x => x.id === id);
   if (!c) { canvasSide.innerHTML = placeholderHTML('Select a character'); return; }

   const hpPct = c.maxHp ? Math.max(0, Math.min(100, (c.currentHp / c.maxHp) * 100)) : 0;
   const hpClass = hpPct <= 25 ? 'critical' : hpPct <= 50 ? 'low' : '';
   const conditions = (c.conditions || '').split(',').map(s => s.trim()).filter(Boolean);

   const subtitleBits = [c.age ? `Age ${escapeHTML(c.age)}` : '', escapeHTML(c.genderPronouns || '')].filter(Boolean).join(' · ');

   const appearanceRows = [
      ['Hair', c.hair], ['Eyes', c.eyes], ['Skin', c.skin], ['Build', c.build],
      ['Height', c.height], ['Clothing Style', c.clothingStyle]
   ].filter(([, val]) => val);

   const section = (title, body) => body ? `<div class="detail-section-title">${title}</div><div class="detail-body">${body}</div>` : '';
   const classColor = classMeta(c.charClass).color;
   const localSheetUrl = dndLocalSheetFor(c.name, c.charClass);

   canvasSide.innerHTML = `<div class="detail-content" style="--char-accent:${classColor};">
		<div class="char-portrait-wrap">${avatarHTML(c, 198, true, true)}</div>
		<span class="detail-label">${escapeHTML(c.race || '')} ${escapeHTML(c.charClass || '')}${c.subclass ? ' (' + escapeHTML(c.subclass) + ')' : ''}${c.edition ? ' · ' + escapeHTML(c.edition) : ''} · Level ${c.level || '?'}</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(c.name)}</h2>
			${headlineIconsGroupHTML(localSheetUrl ? `<a class="headline-icon-btn" href="${localSheetUrl}" title="View Character Sheet">${ICON_SHEET}</a>` : '')}
		</div>
		<div class="detail-subline">${[c.playerName ? 'Played by ' + escapeHTML(c.playerName) : '', subtitleBits].filter(Boolean).join(' · ')}</div>

		<div class="hp-row">
			<span class="hp-text">HP</span>
			<div class="hp-track"><div class="hp-fill ${hpClass}" style="width:${hpPct}%;"></div></div>
			<span class="hp-text">${c.currentHp ?? 0} / ${c.maxHp ?? 0}</span>
		</div>

		${conditions.length ? `<div style="margin-bottom:1.4rem;">${conditions.map(t => `<span class="tag tag-condition">${escapeHTML(t)}</span>`).join('')}</div>` : ''}

		<div class="stat-grid">
			${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => `
				<div class="stat-box">
					<span class="stat-box-label">${k.toUpperCase()}</span>
					<span class="stat-box-value">${c[k] ?? '—'}</span>
				</div>`).join('')}
		</div>

		${(c.background || c.divineConnection || c.familiar || c.effluence) ? `
			<div class="detail-section-title">Overview</div>
			<div class="detail-body">${[
            c.background ? `<strong>Background:</strong> ${escapeHTML(c.background)}` : '',
            c.divineConnection ? `<strong>Divine Connection:</strong> ${escapeHTML(c.divineConnection)}` : '',
            c.familiar ? `<strong>Familiar:</strong> ${escapeHTML(c.familiar)}` : '',
            c.effluence ? `<strong>Effluence:</strong> ${nl2br(c.effluence)}` : ''
         ].filter(Boolean).join('<br>')}</div>` : ''}

		${appearanceRows.length ? `
			<div class="detail-section-title">Appearance</div>
			<div class="detail-body">${appearanceRows.map(([label, val]) => `<strong>${label}:</strong> ${escapeHTML(val)}`).join('<br>')}</div>` : ''}

		${(c.personaOutside || c.personaInside || c.quirks || c.voiceMannerisms || c.dailyHabits) ? `
			<div class="detail-section-title">Personality</div>
			<div class="detail-body">${[
            c.personaOutside ? `<strong>On the Outside:</strong> ${nl2br(c.personaOutside)}` : '',
            c.personaInside ? `<strong>On the Inside:</strong> ${nl2br(c.personaInside)}` : '',
            c.quirks ? `<strong>Quirks:</strong> ${nl2br(c.quirks)}` : '',
            c.voiceMannerisms ? `<strong>Voice &amp; Mannerisms:</strong> ${nl2br(c.voiceMannerisms)}` : '',
            c.dailyHabits ? `<strong>Daily Habits:</strong> ${nl2br(c.dailyHabits)}` : ''
         ].filter(Boolean).join('<br><br>')}</div>` : ''}

		${(c.shortTermGoals || c.longTermGoals || c.stakes) ? `
			<div class="detail-section-title">Goals &amp; Stakes</div>
			<div class="detail-body">${[
            c.shortTermGoals ? `<strong>Short-term:</strong> ${nl2br(c.shortTermGoals)}` : '',
            c.longTermGoals ? `<strong>Long-term:</strong> ${nl2br(c.longTermGoals)}` : '',
            c.stakes ? `<strong>Stakes:</strong> ${nl2br(c.stakes)}` : ''
         ].filter(Boolean).join('<br><br>')}</div>` : ''}

		${section('Backstory', nl2br(c.backstory))}
		${section('Motivation for Joining', nl2br(c.motivationForJoining))}
		${section('Role in the Group', nl2br(c.groupRole))}
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openCharacterModal(c.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(c.name, async () => {
         await deleteRemote(CHARACTERS_TABLE, c.id);
         data.characters = data.characters.filter(x => x.id !== c.id);
         delete state.selectedId.characters;
         saveData();
         renderCharacters();
         toast('Character deleted');
      });
   });
}

const CHAR_DEFAULTS = {
   name: '', playerName: '', age: '', genderPronouns: '', race: '', charClass: '', subclass: '', edition: '2014',
   background: '', divineConnection: '', familiar: '', photo: null,
   level: 1, maxHp: 10, currentHp: 10, conditions: '',
   str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
   hair: '', eyes: '', skin: '', build: '', height: '', clothingStyle: '',
   personaOutside: '', personaInside: '', quirks: '', voiceMannerisms: '', dailyHabits: '',
   shortTermGoals: '', longTermGoals: '', stakes: '',
   backstory: '', motivationForJoining: '', groupRole: '', effluence: ''
};

function openCharacterModal(id) {
   const existing = id ? data.characters.find(x => x.id === id) : null;
   const v = Object.assign({}, CHAR_DEFAULTS, existing || {});
   let currentPhoto = v.photo || null;

   openModal({
      title: existing ? `Edit ${existing.name}` : 'Add New Character',
      bodyHTML: `
			<div class="form-group">
				<label>Profile Picture</label>
				<div class="photo-upload-row">
					<div class="photo-preview" id="photoPreviewWrap">
						${currentPhoto ? `<img id="photoPreviewImg" src="${currentPhoto}" alt="Preview">` : `<span id="photoPreviewPlaceholder">No photo</span>`}
					</div>
					<div class="photo-upload-controls">
						<input id="f-photo" type="file" accept="image/*">
						<button type="button" class="btn btn-ghost btn-small" id="removePhotoBtn" ${currentPhoto ? '' : 'style="display:none;"'}>Remove Photo</button>
					</div>
				</div>
			</div>

			<div class="form-row two">
				<div class="form-group"><label>Name</label><input id="f-name" type="text" value="${escapeHTML(v.name)}"></div>
				<div class="form-group"><label>Player</label><input id="f-playerName" type="text" value="${escapeHTML(v.playerName)}"></div>
			</div>
			<div class="form-row">
				<div class="form-group"><label>Age</label><input id="f-age" type="text" value="${escapeHTML(v.age)}"></div>
				<div class="form-group"><label>Gender / Pronouns</label><input id="f-genderPronouns" type="text" value="${escapeHTML(v.genderPronouns)}"></div>
				<div class="form-group"><label>Level</label><input id="f-level" type="number" value="${v.level}"></div>
			</div>
			<div class="form-row">
				<div class="form-group"><label>Race</label><input id="f-race" type="text" value="${escapeHTML(v.race)}"></div>
				<div class="form-group">
					<label>Sourcebook</label>
					<select id="f-edition">
						<option value="2014" ${v.edition === '2014' ? 'selected' : ''}>Player's Handbook (2014)</option>
						<option value="2024" ${v.edition === '2024' ? 'selected' : ''}>Player's Handbook (2024)</option>
					</select>
				</div>
			</div>
			<div class="form-row">
				<div class="form-group"><label>Class</label><select id="f-charClass">${classOptionsHTML(v.charClass)}</select></div>
				<div class="form-group"><label>Subclass</label><select id="f-subclass">${subclassOptionsHTML(v.charClass, v.edition, v.subclass)}</select></div>
			</div>
			<div class="form-row two">
				<div class="form-group"><label>Background</label><input id="f-background" type="text" value="${escapeHTML(v.background)}"></div>
				<div class="form-group"><label>Divine Connection</label><input id="f-divineConnection" type="text" value="${escapeHTML(v.divineConnection)}"></div>
			</div>
			<div class="form-group"><label>Familiar</label><input id="f-familiar" type="text" value="${escapeHTML(v.familiar)}"></div>
			<div class="form-group"><label>Effluence</label><textarea id="f-effluence">${escapeHTML(v.effluence)}</textarea></div>

			<div class="form-row">
				<div class="form-group"><label>Max HP</label><input id="f-maxHp" type="number" value="${v.maxHp}"></div>
				<div class="form-group"><label>Current HP</label><input id="f-currentHp" type="number" value="${v.currentHp}"></div>
				<div class="form-group"><label>Conditions</label><input id="f-conditions" type="text" placeholder="prone, poisoned" value="${escapeHTML(v.conditions)}"></div>
			</div>
			<div class="form-group"><label>Ability Scores</label></div>
			<div class="form-row" style="margin-bottom:1.3rem;">
				${['str', 'dex', 'con'].map(k => `<div class="form-group"><label>${k.toUpperCase()}</label><input id="f-${k}" type="number" value="${v[k]}"></div>`).join('')}
			</div>
			<div class="form-row">
				${['int', 'wis', 'cha'].map(k => `<div class="form-group"><label>${k.toUpperCase()}</label><input id="f-${k}" type="number" value="${v[k]}"></div>`).join('')}
			</div>

			<div class="form-section-label">Appearance</div>
			<div class="form-row">
				<div class="form-group"><label>Hair</label><input id="f-hair" type="text" value="${escapeHTML(v.hair)}"></div>
				<div class="form-group"><label>Eyes</label><input id="f-eyes" type="text" value="${escapeHTML(v.eyes)}"></div>
				<div class="form-group"><label>Skin</label><input id="f-skin" type="text" value="${escapeHTML(v.skin)}"></div>
			</div>
			<div class="form-row">
				<div class="form-group"><label>Build</label><input id="f-build" type="text" value="${escapeHTML(v.build)}"></div>
				<div class="form-group"><label>Height</label><input id="f-height" type="text" value="${escapeHTML(v.height)}"></div>
				<div class="form-group"><label>Clothing Style</label><input id="f-clothingStyle" type="text" value="${escapeHTML(v.clothingStyle)}"></div>
			</div>

			<div class="form-section-label">Personality</div>
			<div class="form-group"><label>On the Outside</label><textarea id="f-personaOutside">${escapeHTML(v.personaOutside)}</textarea></div>
			<div class="form-group"><label>On the Inside</label><textarea id="f-personaInside">${escapeHTML(v.personaInside)}</textarea></div>
			<div class="form-group"><label>Quirks</label><textarea id="f-quirks">${escapeHTML(v.quirks)}</textarea></div>
			<div class="form-group"><label>Voice &amp; Mannerisms</label><textarea id="f-voiceMannerisms">${escapeHTML(v.voiceMannerisms)}</textarea></div>
			<div class="form-group"><label>Daily / Little Habits</label><textarea id="f-dailyHabits">${escapeHTML(v.dailyHabits)}</textarea></div>

			<div class="form-section-label">Goals &amp; Stakes</div>
			<div class="form-group"><label>Short-term Goals</label><textarea id="f-shortTermGoals">${escapeHTML(v.shortTermGoals)}</textarea></div>
			<div class="form-group"><label>Long-term Goals</label><textarea id="f-longTermGoals">${escapeHTML(v.longTermGoals)}</textarea></div>
			<div class="form-group"><label>Stakes</label><textarea id="f-stakes">${escapeHTML(v.stakes)}</textarea></div>

			<div class="form-section-label">Backstory &amp; Group</div>
			<div class="form-group"><label>Personal Backstory</label><textarea id="f-backstory" style="min-height:140px;">${escapeHTML(v.backstory)}</textarea></div>
			<div class="form-group"><label>Motivation for Joining</label><textarea id="f-motivationForJoining">${escapeHTML(v.motivationForJoining)}</textarea></div>
			<div class="form-group"><label>Role / Value to the Group</label><textarea id="f-groupRole">${escapeHTML(v.groupRole)}</textarea></div>
		`,
      onSave: async () => {
         const name = document.getElementById('f-name').value.trim();
         if (!name) { toast('Name is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            name,
            photo: currentPhoto,
            playerName: document.getElementById('f-playerName').value.trim(),
            age: document.getElementById('f-age').value.trim(),
            genderPronouns: document.getElementById('f-genderPronouns').value.trim(),
            race: document.getElementById('f-race').value.trim(),
            edition: document.getElementById('f-edition').value,
            charClass: document.getElementById('f-charClass').value,
            subclass: document.getElementById('f-subclass').value,
            background: document.getElementById('f-background').value.trim(),
            divineConnection: document.getElementById('f-divineConnection').value.trim(),
            familiar: document.getElementById('f-familiar').value.trim(),
            level: Number(document.getElementById('f-level').value) || 1,
            maxHp: Number(document.getElementById('f-maxHp').value) || 0,
            currentHp: Number(document.getElementById('f-currentHp').value) || 0,
            conditions: document.getElementById('f-conditions').value.trim(),
            str: Number(document.getElementById('f-str').value) || 10,
            dex: Number(document.getElementById('f-dex').value) || 10,
            con: Number(document.getElementById('f-con').value) || 10,
            int: Number(document.getElementById('f-int').value) || 10,
            wis: Number(document.getElementById('f-wis').value) || 10,
            cha: Number(document.getElementById('f-cha').value) || 10,
            hair: document.getElementById('f-hair').value.trim(),
            eyes: document.getElementById('f-eyes').value.trim(),
            skin: document.getElementById('f-skin').value.trim(),
            build: document.getElementById('f-build').value.trim(),
            height: document.getElementById('f-height').value.trim(),
            clothingStyle: document.getElementById('f-clothingStyle').value.trim(),
            personaOutside: document.getElementById('f-personaOutside').value.trim(),
            personaInside: document.getElementById('f-personaInside').value.trim(),
            quirks: document.getElementById('f-quirks').value.trim(),
            voiceMannerisms: document.getElementById('f-voiceMannerisms').value.trim(),
            dailyHabits: document.getElementById('f-dailyHabits').value.trim(),
            shortTermGoals: document.getElementById('f-shortTermGoals').value.trim(),
            longTermGoals: document.getElementById('f-longTermGoals').value.trim(),
            stakes: document.getElementById('f-stakes').value.trim(),
            backstory: document.getElementById('f-backstory').value.trim(),
            effluence: document.getElementById('f-effluence').value.trim(),
            motivationForJoining: document.getElementById('f-motivationForJoining').value.trim(),
            groupRole: document.getElementById('f-groupRole').value.trim()
         };
         const saved = existing
            ? await updateCharacterRemote(existing.id, record)
            : await insertCharacterRemote(record);

         if (!saved) {
            // insertCharacterRemote/updateCharacterRemote already toasted the reason.
            // Keep the modal open (return false) so nothing is lost.
            return false;
         }

         if (existing) {
            const idx = data.characters.findIndex(x => x.id === existing.id);
            data.characters[idx] = record;
         } else {
            data.characters.push(record);
            state.selectedId.characters = record.id;
         }
         saveData(); // keep a local cache too, so the UI still works offline
         renderCharacters();
         toast(existing ? 'Character updated' : 'Character added');
      }
   });

   // Class / edition wiring — subclass options depend on both
   const classSelect = document.getElementById('f-charClass');
   const editionSelect = document.getElementById('f-edition');
   const subclassSelect = document.getElementById('f-subclass');
   function refreshSubclasses(keepCurrent) {
      const keep = keepCurrent ? v.subclass : '';
      subclassSelect.innerHTML = subclassOptionsHTML(classSelect.value, editionSelect.value, keep);
   }
   classSelect.addEventListener('change', () => refreshSubclasses(false));
   editionSelect.addEventListener('change', () => refreshSubclasses(false));

   // Photo upload wiring (elements now exist in the DOM since openModal ran synchronously)
   const photoInput = document.getElementById('f-photo');
   const previewWrap = document.getElementById('photoPreviewWrap');
   const removeBtn = document.getElementById('removePhotoBtn');

   photoInput.addEventListener('change', async () => {
      const file = photoInput.files[0];
      if (!file) return;
      previewWrap.innerHTML = `<span id="photoPreviewPlaceholder">Uploading…</span>`;
      photoInput.disabled = true;
      try {
         const publicUrl = await uploadPortraitImage(file);
         if (!publicUrl) {
            // uploadPortraitImage already toasted the specific error
            previewWrap.innerHTML = currentPhoto
               ? `<img id="photoPreviewImg" src="${currentPhoto}" alt="Preview">`
               : `<span id="photoPreviewPlaceholder">No photo</span>`;
            return;
         }
         currentPhoto = publicUrl;
         previewWrap.innerHTML = `<img id="photoPreviewImg" src="${publicUrl}" alt="Preview">`;
         removeBtn.style.display = '';
      } finally {
         photoInput.disabled = false;
         photoInput.value = '';
      }
   });

   removeBtn.addEventListener('click', () => {
      currentPhoto = null;
      photoInput.value = '';
      previewWrap.innerHTML = `<span id="photoPreviewPlaceholder">No photo</span>`;
      removeBtn.style.display = 'none';
   });
}

/* ============================================================
   NPCS
   ============================================================ */
function renderNPCs() {
   const search = (state.search.npcs || '').toLowerCase();
   const list = data.npcs.filter(n =>
      !search || n.name.toLowerCase().includes(search) || (n.location || '').toLowerCase().includes(search) || (n.affiliation || '').toLowerCase().includes(search)
   );
   const selectedId = state.selectedId.npcs || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">Cast of Characters</span>
				<h1 class="section-title">NPCs</h1>
			</div>
			<button class="btn" id="addBtn">+ Add NPC</button>
		</div>
		<div class="toolbar">
			<input class="search-input" id="searchInput" type="text" placeholder="Search by name, location, or affiliation…" value="${escapeHTML(state.search.npcs || '')}">
		</div>
		<ul class="entry-list">
			${list.length ? list.map(n => npcEntryItem(n, n.id === selectedId)).join('')
         : `<li class="empty-state">No NPCs match your search.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openNPCModal());
   const searchInput = document.getElementById('searchInput');
   searchInput.addEventListener('input', () => {
      state.search.npcs = searchInput.value;
      renderNPCs();
   });
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.npcs) return;
         state.selectedId.npcs = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderNPCDetail(item.dataset.id);
      });
   });

   renderNPCDetail(selectedId);
}

function renderNPCDetail(id) {
   const n = data.npcs.find(x => x.id === id);
   if (!n) { canvasSide.innerHTML = placeholderHTML('Select an NPC'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<div class="char-portrait-wrap">${npcAvatarHTML(n, 160)}</div>
		<span class="detail-label">${escapeHTML(n.affiliation || 'Unaffiliated')}</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(n.name)}</h2>
			${headlineIconsHTML()}
		</div>
		<div class="detail-subline">${n.location ? 'Last seen: ' + escapeHTML(n.location) : ''}</div>
		<div class="detail-section-title">Notes</div>
		<div class="detail-body">${nl2br(n.notes) || '<span style="color:var(--ink-light);">No notes yet.</span>'}</div>
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openNPCModal(n.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(n.name, async () => {
         await deleteRemote('npcs', n.id);
         data.npcs = data.npcs.filter(x => x.id !== n.id);
         delete state.selectedId.npcs;
         saveData();
         renderNPCs();
         toast('NPC deleted');
      });
   });
}

function openNPCModal(id) {
   const existing = id ? data.npcs.find(x => x.id === id) : null;
   const v = existing || { name: '', location: '', affiliation: '', notes: '', photo: null };
   let currentPhoto = v.photo || null;

   openModal({
      title: existing ? `Edit ${existing.name}` : 'Add New NPC',
      bodyHTML: `
			<div class="form-group">
				<label>Profile Picture</label>
				<div class="photo-upload-row">
					<div class="photo-preview" id="photoPreviewWrap">
						${currentPhoto ? `<img id="photoPreviewImg" src="${currentPhoto}" alt="Preview">` : `<span id="photoPreviewPlaceholder">No photo</span>`}
					</div>
					<div class="photo-upload-controls">
						<input id="f-photo" type="file" accept="image/*">
						<button type="button" class="btn btn-ghost btn-small" id="removePhotoBtn" ${currentPhoto ? '' : 'style="display:none;"'}>Remove Photo</button>
					</div>
				</div>
			</div>

			<div class="form-group"><label>Name</label><input id="f-name" type="text" value="${escapeHTML(v.name)}"></div>
			<div class="form-row two">
				<div class="form-group"><label>Location</label><input id="f-location" type="text" value="${escapeHTML(v.location)}"></div>
				<div class="form-group"><label>Affiliation</label><input id="f-affiliation" type="text" value="${escapeHTML(v.affiliation)}"></div>
			</div>
			<div class="form-group"><label>Notes</label><textarea id="f-notes">${escapeHTML(v.notes)}</textarea></div>
		`,
      onSave: async () => {
         const name = document.getElementById('f-name').value.trim();
         if (!name) { toast('Name is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            name,
            portrait_url: currentPhoto,
            location: document.getElementById('f-location').value.trim(),
            affiliation: document.getElementById('f-affiliation').value.trim(),
            notes: document.getElementById('f-notes').value.trim()
         };
         await upsertRemote('npcs', record);
         if (existing) {
            data.npcs[data.npcs.findIndex(x => x.id === existing.id)] = { ...record, photo: currentPhoto };
         } else {
            data.npcs.push({ ...record, photo: currentPhoto });
            state.selectedId.npcs = record.id;
         }
         saveData();
         renderNPCs();
         toast(existing ? 'NPC updated' : 'NPC added');
      }
   });

   // Photo upload wiring (elements now exist in the DOM since openModal ran synchronously)
   const photoInput = document.getElementById('f-photo');
   const previewWrap = document.getElementById('photoPreviewWrap');
   const removeBtn = document.getElementById('removePhotoBtn');

   photoInput.addEventListener('change', async () => {
      const file = photoInput.files[0];
      if (!file) return;
      try {
         const dataUrl = await readImageAsDataURL(file, 500);
         currentPhoto = dataUrl;
         previewWrap.innerHTML = `<img id="photoPreviewImg" src="${dataUrl}" alt="Preview">`;
         removeBtn.style.display = '';
      } catch (err) {
         toast('Could not read that image');
      }
   });

   removeBtn.addEventListener('click', () => {
      currentPhoto = null;
      photoInput.value = '';
      previewWrap.innerHTML = `<span id="photoPreviewPlaceholder">No photo</span>`;
      removeBtn.style.display = 'none';
   });
}

/* ============================================================
   WORLD LORE
   ============================================================ */
const LORE_CATEGORIES = ['Faction', 'City', 'Deity', 'History', 'Other'];

function renderLore() {
   const filter = state.filter.lore || 'All';
   const list = data.lore.filter(l => filter === 'All' || l.category === filter);
   const selectedId = state.selectedId.lore || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">The Wiki</span>
				<h1 class="section-title">World Lore</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Entry</button>
		</div>
		<div class="toolbar">
			<div class="filter-chips">
				${['All', ...LORE_CATEGORIES].map(cat => `<button class="filter-chip ${filter === cat ? 'active' : ''}" data-cat="${cat}">${cat}</button>`).join('')}
			</div>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(l => entryItem(l.id, 'lore', l.title, l.category, l.id === selectedId)).join('')
         : `<li class="empty-state">No lore entries in this category yet.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openLoreModal());
   leftSide.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
         state.filter.lore = chip.dataset.cat;
         renderLore();
      });
   });
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.lore) return;
         state.selectedId.lore = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderLoreDetail(item.dataset.id);
      });
   });

   renderLoreDetail(selectedId);
}

function renderLoreDetail(id) {
   const l = data.lore.find(x => x.id === id);
   if (!l) { canvasSide.innerHTML = placeholderHTML('Select a lore entry'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<span class="detail-label">${escapeHTML(l.category)}</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(l.title)}</h2>
			${headlineIconsHTML()}
		</div>
		<div class="detail-body">${nl2br(l.content)}</div>
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openLoreModal(l.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(l.title, async () => {
         await deleteRemote('lore', l.id);
         data.lore = data.lore.filter(x => x.id !== l.id);
         delete state.selectedId.lore;
         saveData();
         renderLore();
         toast('Lore entry deleted');
      });
   });
}

function openLoreModal(id) {
   const existing = id ? data.lore.find(x => x.id === id) : null;
   const v = existing || { title: '', category: 'Faction', content: '' };

   openModal({
      title: existing ? `Edit ${existing.title}` : 'Add Lore Entry',
      bodyHTML: `
			<div class="form-row two">
				<div class="form-group"><label>Title</label><input id="f-title" type="text" value="${escapeHTML(v.title)}"></div>
				<div class="form-group"><label>Category</label>
					<select id="f-category">${LORE_CATEGORIES.map(c => `<option value="${c}" ${v.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
				</div>
			</div>
			<div class="form-group"><label>Content</label><textarea id="f-content" style="min-height:160px;">${escapeHTML(v.content)}</textarea></div>
		`,
      onSave: async () => {
         const title = document.getElementById('f-title').value.trim();
         if (!title) { toast('Title is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            title,
            category: document.getElementById('f-category').value,
            content: document.getElementById('f-content').value.trim()
         };
         await upsertRemote('lore', record);
         if (existing) {
            data.lore[data.lore.findIndex(x => x.id === existing.id)] = record;
         } else {
            data.lore.push(record);
            state.selectedId.lore = record.id;
         }
         saveData();
         renderLore();
         toast(existing ? 'Lore updated' : 'Lore entry added');
      }
   });
}

/* ============================================================
   QUEST BOARD
   ============================================================ */
const QUEST_STATUSES = ['Active', 'Completed', 'Side'];

function renderQuests() {
   const filter = state.filter.quests || 'All';
   const list = data.quests.filter(q => filter === 'All' || q.status === filter);
   const selectedId = state.selectedId.quests || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">The Board</span>
				<h1 class="section-title">Quests</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Quest</button>
		</div>
		<div class="toolbar">
			<div class="filter-chips">
				${['All', ...QUEST_STATUSES].map(s => `<button class="filter-chip ${filter === s ? 'active' : ''}" data-status="${s}">${s}</button>`).join('')}
			</div>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(q => entryItem(q.id, 'quests', q.title, `<span class="badge badge-${q.status.toLowerCase()}">${q.status}</span>`, q.id === selectedId)).join('')
         : `<li class="empty-state">No quests in this filter.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openQuestModal());
   leftSide.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
         state.filter.quests = chip.dataset.status;
         renderQuests();
      });
   });
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.quests) return;
         state.selectedId.quests = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderQuestDetail(item.dataset.id);
      });
   });

   renderQuestDetail(selectedId);
}

function renderQuestDetail(id) {
   const q = data.quests.find(x => x.id === id);
   if (!q) { canvasSide.innerHTML = placeholderHTML('Select a quest'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<span class="badge badge-${q.status.toLowerCase()}" style="margin-bottom:1rem; display:inline-block;">${q.status}</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(q.title)}</h2>
			${headlineIconsHTML()}
		</div>
		<div class="detail-section-title">Description</div>
		<div class="detail-body">${nl2br(q.description) || '<span style="color:var(--ink-light);">No description yet.</span>'}</div>
		${q.reward ? `<div class="detail-section-title">Reward</div><div class="detail-body">${escapeHTML(q.reward)}</div>` : ''}
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openQuestModal(q.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(q.title, async () => {
         await deleteRemote('quests', q.id);
         data.quests = data.quests.filter(x => x.id !== q.id);
         delete state.selectedId.quests;
         saveData();
         renderQuests();
         toast('Quest deleted');
      });
   });
}

function openQuestModal(id) {
   const existing = id ? data.quests.find(x => x.id === id) : null;
   const v = existing || { title: '', status: 'Active', description: '', reward: '' };

   openModal({
      title: existing ? `Edit ${existing.title}` : 'Add New Quest',
      bodyHTML: `
			<div class="form-row two">
				<div class="form-group"><label>Title</label><input id="f-title" type="text" value="${escapeHTML(v.title)}"></div>
				<div class="form-group"><label>Status</label>
					<select id="f-status">${QUEST_STATUSES.map(s => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
				</div>
			</div>
			<div class="form-group"><label>Description</label><textarea id="f-description">${escapeHTML(v.description)}</textarea></div>
			<div class="form-group"><label>Reward</label><input id="f-reward" type="text" value="${escapeHTML(v.reward)}"></div>
		`,
      onSave: async () => {
         const title = document.getElementById('f-title').value.trim();
         if (!title) { toast('Title is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            title,
            status: document.getElementById('f-status').value,
            description: document.getElementById('f-description').value.trim(),
            reward: document.getElementById('f-reward').value.trim()
         };
         await upsertRemote('quests', record);
         if (existing) {
            data.quests[data.quests.findIndex(x => x.id === existing.id)] = record;
         } else {
            data.quests.push(record);
            state.selectedId.quests = record.id;
         }
         saveData();
         renderQuests();
         toast(existing ? 'Quest updated' : 'Quest added');
      }
   });
}

/* ============================================================
   SESSION NOTES
   ============================================================ */
function renderSessions() {
   const list = [...data.sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
   const selectedId = state.selectedId.sessions || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">The Chronicle</span>
				<h1 class="section-title">Session Notes</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Session</button>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(s => entryItem(s.id, 'sessions', s.title, escapeHTML(s.date || ''), s.id === selectedId)).join('')
         : `<li class="empty-state">No sessions logged yet.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openSessionModal());
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.sessions) return;
         state.selectedId.sessions = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderSessionDetail(item.dataset.id);
      });
   });

   renderSessionDetail(selectedId);
}

function renderSessionDetail(id) {
   const s = data.sessions.find(x => x.id === id);
   if (!s) { canvasSide.innerHTML = placeholderHTML('Select a session'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<span class="detail-label">${escapeHTML(s.date || '')}</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(s.title)}</h2>
			${headlineIconsHTML()}
		</div>
		<div class="detail-body">${nl2br(s.recap)}</div>
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openSessionModal(s.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(s.title, async () => {
         await deleteRemote('sessions', s.id);
         data.sessions = data.sessions.filter(x => x.id !== s.id);
         delete state.selectedId.sessions;
         saveData();
         renderSessions();
         toast('Session deleted');
      });
   });
}

function openSessionModal(id) {
   const existing = id ? data.sessions.find(x => x.id === id) : null;
   const v = existing || { date: new Date().toISOString().slice(0, 10), title: '', recap: '' };

   openModal({
      title: existing ? `Edit ${existing.title}` : 'Add Session Recap',
      bodyHTML: `
			<div class="form-row two">
				<div class="form-group"><label>Date</label><input id="f-date" type="date" value="${escapeHTML(v.date)}"></div>
				<div class="form-group"><label>Title</label><input id="f-title" type="text" value="${escapeHTML(v.title)}"></div>
			</div>
			<div class="form-group"><label>Recap</label><textarea id="f-recap" style="min-height:180px;">${escapeHTML(v.recap)}</textarea></div>
		`,
      onSave: async () => {
         const title = document.getElementById('f-title').value.trim();
         if (!title) { toast('Title is required'); return false; }
         const dateVal = document.getElementById('f-date').value || null;
         const record = {
            id: existing ? existing.id : uid(),
            date: dateVal,
            title,
            recap: document.getElementById('f-recap').value.trim()
         };
         await upsertRemote('sessions', record);
         if (existing) {
            data.sessions[data.sessions.findIndex(x => x.id === existing.id)] = record;
         } else {
            data.sessions.push(record);
            state.selectedId.sessions = record.id;
         }
         saveData();
         renderSessions();
         toast(existing ? 'Session updated' : 'Session added');
      }
   });
}

/* ============================================================
   TREASURY
   ============================================================ */
function renderTreasury() {
   const list = data.treasury.loot;
   const selectedId = state.selectedId.treasury || (list[0] && list[0].id);
   const log = [...data.treasury.log].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">Shared Hoard</span>
				<h1 class="section-title">Treasury</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Loot</button>
		</div>

		<div class="detail-content" style="padding-top:0;">
			<span class="detail-label">Party Funds</span>
			<div class="gold-display">
				<span class="gold-number">${data.treasury.gold}</span>
				<span class="gold-unit">${ICON_COINS}</span>
			</div>
			<div class="gold-adjust">
				<input type="number" id="goldAmount" placeholder="Amount">
				<input type="text" id="goldNote" placeholder="Reason (e.g. sold gems)">
				<button class="btn btn-ghost btn-small" id="goldAdd">+ Add</button>
				<button class="btn btn-danger btn-small" id="goldSub">− Spend</button>
			</div>

			<div class="detail-section-title">Ledger</div>
			<ul class="ledger-log">
				${log.length ? log.map(g => `<li data-id="${g.id}">
					<span class="ledger-log-desc">${escapeHTML(g.date)} — ${escapeHTML(g.note || '')}</span>
					<span class="ledger-log-right">
						<span class="${g.change >= 0 ? 'amt-pos' : 'amt-neg'}">${g.change >= 0 ? '+' : ''}${g.change} gp</span>
						<button type="button" class="ledger-log-btn ledger-edit-btn" data-id="${g.id}" title="Edit transaction">${ICON_EDIT}</button>
						<button type="button" class="ledger-log-btn ledger-delete-btn" data-id="${g.id}" title="Delete transaction">${ICON_TRASH}</button>
					</span>
				</li>`).join('')
         : '<li style="color:var(--ink-light);">No transactions yet.</li>'}
			</ul>

			<div class="detail-section-title">Magic Items &amp; Loot</div>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(t => entryItem(t.id, 'treasury', t.name, t.value ? `${t.value} gp` : 'Unvalued', t.id === selectedId)).join('')
         : `<li class="empty-state">No magic items or loot logged yet.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openLootModal());

   document.getElementById('goldAdd').addEventListener('click', () => adjustGold(1));
   document.getElementById('goldSub').addEventListener('click', () => adjustGold(-1));

   leftSide.querySelectorAll('.ledger-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openLedgerEntryModal(btn.dataset.id));
   });
   leftSide.querySelectorAll('.ledger-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteLedgerEntry(btn.dataset.id));
   });

   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.treasury) return;
         state.selectedId.treasury = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderTreasuryDetail(item.dataset.id);
      });
   });

   renderTreasuryDetail(selectedId);
}

function renderTreasuryDetail(selectedLootId) {
   const loot = data.treasury.loot.find(x => x.id === selectedLootId);
   if (!loot) { canvasSide.innerHTML = placeholderHTML('Select an item from the list to view details'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<span class="detail-label">Magic Item / Loot</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(loot.name)}</h2>
			${headlineIconsHTML('editLootBtn', 'deleteLootBtn')}
		</div>
		${loot.value ? `<div class="detail-subline">Estimated value: ${loot.value} gp</div>` : ''}
		<div class="detail-body">${nl2br(loot.description) || '<span style="color:var(--ink-light);">No description yet.</span>'}</div>
	</div>`;

   document.getElementById('editLootBtn').addEventListener('click', () => openLootModal(loot.id));
   document.getElementById('deleteLootBtn').addEventListener('click', () => {
      confirmDelete(loot.name, async () => {
         await deleteRemote('loot', loot.id);
         data.treasury.loot = data.treasury.loot.filter(x => x.id !== loot.id);
         delete state.selectedId.treasury;
         saveData();
         renderTreasury();
         toast('Loot item deleted');
      });
   });
}

async function adjustGold(sign) {
   const amountInput = document.getElementById('goldAmount');
   const noteInput = document.getElementById('goldNote');
   const amount = Number(amountInput.value);
   if (!amount || amount <= 0) { toast('Enter a positive amount'); return; }
   const change = sign * amount;
   data.treasury.gold = Math.max(0, data.treasury.gold + change);
   const logEntry = {
      id: uid(),
      date: new Date().toISOString().slice(0, 10),
      change,
      note: noteInput.value.trim()
   };
   data.treasury.log.push(logEntry);
   await upsertRemote('treasury_log', logEntry);
   await syncGoldRemote(data.treasury.gold);
   saveData();
   renderTreasury();
   toast(sign > 0 ? 'Gold added' : 'Gold spent');
}

function openLedgerEntryModal(id) {
   const entry = data.treasury.log.find(x => x.id === id);
   if (!entry) return;

   openModal({
      title: 'Edit Transaction',
      bodyHTML: `
			<div class="form-row two">
				<div class="form-group"><label>Date</label><input id="f-date" type="date" value="${escapeHTML(entry.date)}"></div>
				<div class="form-group"><label>Amount (+/- gp)</label><input id="f-change" type="number" value="${entry.change}"></div>
			</div>
			<div class="form-group"><label>Note</label><input id="f-note" type="text" value="${escapeHTML(entry.note || '')}"></div>
		`,
      onSave: async () => {
         const newChange = Number(document.getElementById('f-change').value);
         if (!newChange) { toast('Amount cannot be 0'); return false; }
         data.treasury.gold = Math.max(0, data.treasury.gold - entry.change + newChange);
         entry.date = document.getElementById('f-date').value || entry.date;
         entry.change = newChange;
         entry.note = document.getElementById('f-note').value.trim();
         await upsertRemote('treasury_log', { id: entry.id, date: entry.date, change: entry.change, note: entry.note });
         await syncGoldRemote(data.treasury.gold);
         saveData();
         renderTreasury();
         toast('Transaction updated');
      }
   });
}

function deleteLedgerEntry(id) {
   const entry = data.treasury.log.find(x => x.id === id);
   if (!entry) return;
   confirmDelete(entry.note || 'this transaction', async () => {
      await deleteRemote('treasury_log', id);
      data.treasury.gold = Math.max(0, data.treasury.gold - entry.change);
      data.treasury.log = data.treasury.log.filter(x => x.id !== id);
      saveData();
      renderTreasury();
      toast('Transaction deleted');
   });
}

function openLootModal(id) {
   const existing = id ? data.treasury.loot.find(x => x.id === id) : null;
   const v = existing || { name: '', value: '', description: '' };

   openModal({
      title: existing ? `Edit ${existing.name}` : 'Add Loot Item',
      bodyHTML: `
			<div class="form-row two">
				<div class="form-group"><label>Item Name</label><input id="f-name" type="text" value="${escapeHTML(v.name)}"></div>
				<div class="form-group"><label>Value (gp)</label><input id="f-value" type="number" value="${v.value}"></div>
			</div>
			<div class="form-group"><label>Description</label><textarea id="f-description">${escapeHTML(v.description)}</textarea></div>
		`,
      onSave: async () => {
         const name = document.getElementById('f-name').value.trim();
         if (!name) { toast('Item name is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            name,
            value: Number(document.getElementById('f-value').value) || 0,
            description: document.getElementById('f-description').value.trim()
         };
         await upsertRemote('loot', record);
         if (existing) {
            data.treasury.loot[data.treasury.loot.findIndex(x => x.id === existing.id)] = record;
         } else {
            data.treasury.loot.push(record);
            state.selectedId.treasury = record.id;
         }
         saveData();
         renderTreasury();
         toast(existing ? 'Loot updated' : 'Loot added');
      }
   });
}

/* ============================================================
   HOMEBREW RULES
   ============================================================ */
function renderRules() {
   const list = data.rules;
   const selectedId = state.selectedId.rules || (list[0] && list[0].id);

   leftSide.innerHTML = `
		<div class="section-header">
			<div>
				<span class="section-eyebrow">Quick Reference</span>
				<h1 class="section-title">Homebrew Rules</h1>
			</div>
			<button class="btn" id="addBtn">+ Add Rule</button>
		</div>
		<ul class="entry-list">
			${list.length ? list.map(r => entryItem(r.id, 'rules', r.title, '', r.id === selectedId)).join('')
         : `<li class="empty-state">No homebrew rules yet.</li>`}
		</ul>
	`;
   document.getElementById('addBtn').addEventListener('click', () => openRuleModal());
   leftSide.querySelectorAll('.entry-item').forEach(item => {
      item.addEventListener('click', () => {
         if (item.dataset.id === state.selectedId.rules) return;
         state.selectedId.rules = item.dataset.id;
         leftSide.querySelectorAll('.entry-item.active').forEach(el => el.classList.remove('active'));
         item.classList.add('active');
         renderRuleDetail(item.dataset.id);
      });
   });

   renderRuleDetail(selectedId);
}

function renderRuleDetail(id) {
   const r = data.rules.find(x => x.id === id);
   if (!r) { canvasSide.innerHTML = placeholderHTML('Select a rule'); return; }

   canvasSide.innerHTML = `<div class="detail-content">
		<span class="detail-label">House Rule</span>
		<div class="headline-row">
			<h2 class="detail-headline">${escapeHTML(r.title)}</h2>
			${headlineIconsHTML()}
		</div>
		<div class="detail-body">${nl2br(r.content)}</div>
	</div>`;

   document.getElementById('editBtn').addEventListener('click', () => openRuleModal(r.id));
   document.getElementById('deleteBtn').addEventListener('click', () => {
      confirmDelete(r.title, () => {
         data.rules = data.rules.filter(x => x.id !== r.id);
         delete state.selectedId.rules;
         saveData();
         renderRules();
         toast('Rule deleted');
      });
   });
}

function openRuleModal(id) {
   const existing = id ? data.rules.find(x => x.id === id) : null;
   const v = existing || { title: '', content: '' };

   openModal({
      title: existing ? `Edit ${existing.title}` : 'Add Homebrew Rule',
      bodyHTML: `
			<div class="form-group"><label>Title</label><input id="f-title" type="text" value="${escapeHTML(v.title)}"></div>
			<div class="form-group"><label>Rule Text</label><textarea id="f-content" style="min-height:140px;">${escapeHTML(v.content)}</textarea></div>
		`,
      onSave: async () => {
         const title = document.getElementById('f-title').value.trim();
         if (!title) { toast('Title is required'); return false; }
         const record = {
            id: existing ? existing.id : uid(),
            title,
            content: document.getElementById('f-content').value.trim()
         };
         await upsertRemote('rules', record);
         if (existing) {
            data.rules[data.rules.findIndex(x => x.id === existing.id)] = record;
         } else {
            data.rules.push(record);
            state.selectedId.rules = record.id;
         }
         saveData();
         renderRules();
         toast(existing ? 'Rule updated' : 'Rule added');
      }
   });
}

/* ============================================================
   GENERIC MODAL
   ============================================================ */
function openModal({ title, bodyHTML, onSave }) {
   modalRoot.innerHTML = `
		<div class="modal-overlay" id="modalOverlay">
			<div class="modal-card">
				<div class="modal-header">
					<span class="modal-title">${escapeHTML(title)}</span>
					<button class="modal-close" id="modalClose">&times;</button>
				</div>
				<form id="modalForm">
					${bodyHTML}
					<div class="modal-footer">
						<button type="button" class="btn btn-ghost" id="modalCancel">Cancel</button>
						<div class="modal-footer-right">
							<button type="submit" class="btn">Save</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	`;

   const overlay = document.getElementById('modalOverlay');
   const form = document.getElementById('modalForm');

   function close() {
      modalRoot.innerHTML = '';
   }

   document.getElementById('modalClose').addEventListener('click', close);
   document.getElementById('modalCancel').addEventListener('click', close);
   overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
   document.addEventListener('keydown', escHandler);
   function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
   }

   form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = form.querySelector('.modal-footer-right .btn');
      const originalLabel = saveBtn ? saveBtn.textContent : '';
      try {
         if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
         const result = await onSave();
         if (result !== false) close();
      } catch (err) {
         console.error('Save failed:', err);
         toast('Something went wrong saving — please try again');
      } finally {
         if (saveBtn && modalRoot.contains(saveBtn)) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalLabel;
         }
      }
   });
}

function confirmDelete(name, onConfirm) {
   openModal({
      title: `Delete "${name}"?`,
      bodyHTML: `<p style="font-size:0.88rem; line-height:1.6; color:var(--ink-light); margin-bottom:0.5rem;">This can't be undone. The entry will be permanently removed from your ledger.</p>`,
      onSave: () => { onConfirm(); }
   });
   // Swap the default Save button for a Delete-styled one
   const saveBtn = modalRoot.querySelector('.modal-footer-right .btn');
   saveBtn.textContent = 'Delete';
   saveBtn.classList.add('btn-danger');
}

/* ============================================================
   EXPORT / IMPORT / RESET
   ============================================================ */
document.getElementById('exportBtn').addEventListener('click', (e) => {
   e.preventDefault();
   const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `wayfarers-ledger-${new Date().toISOString().slice(0, 10)}.json`;
   a.click();
   URL.revokeObjectURL(url);
   toast('Exported campaign data');
});
async function fetchCharacterData(characterId) {
   // 1. The original D&D Beyond URL
   const ddbUrl = `https://character-service.dndbeyond.com/character/v5/character/${characterId}`;

   // 2. Wrap the URL in a free public CORS proxy
   const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(ddbUrl)}`;

   try {
      console.log(`Fetching character ${characterId} via proxy...`);
      const response = await fetch(proxyUrl);

      if (!response.ok) {
         throw new Error(`Failed to fetch. Status: ${response.status}`);
      }

      const data = await response.json();

      // D&D Beyond nests the actual character details inside a "data" property
      return data.data;

   } catch (error) {
      console.error("Error fetching character data:", error);
      throw error;
   }
}
const importFile = document.getElementById('importFile');
document.getElementById('importBtn').addEventListener('click', (e) => {
   e.preventDefault();
   importFile.click();
});
importFile.addEventListener('change', () => {
   const file = importFile.files[0];
   if (!file) return;
   const reader = new FileReader();
   reader.onload = () => {
      try {
         const parsed = JSON.parse(reader.result);
         data = parsed;
         saveData();
         state.selectedId = {};
         render();
         toast('Campaign data imported');
      } catch (err) {
         toast('Import failed — invalid file');
      }
   };
   reader.readAsText(file);
   importFile.value = '';
});

document.getElementById('resetBtn').addEventListener('click', (e) => {
   e.preventDefault();
   openModal({
      title: 'Reset all data?',
      bodyHTML: `<p style="font-size:0.88rem; line-height:1.6; color:var(--ink-light);">This wipes every character, NPC, quest, and session in this browser and restores the starter example. Export first if you want a backup.</p>`,
      onSave: () => {
         localStorage.removeItem(STORAGE_KEY);
         data = loadData();
         state.selectedId = {};
         render();
         toast('Data reset');
      }
   });
   const saveBtn = modalRoot.querySelector('.modal-footer-right .btn');
   saveBtn.textContent = 'Reset';
   saveBtn.classList.add('btn-danger');
});

/* ============================================================
   INIT — load everything from Supabase, then re-render
   ============================================================ */
navLinks.forEach(l => l.classList.toggle('nav-active', l.dataset.nav === state.section));
settleNavIndicator();
splitContainer.classList.toggle('list-detail-mode', state.section !== 'dashboard');

// If we were in mobile-detail-view before navigating away (e.g. to dnd-sheet.html),
// restore that class NOW — before the first render — so the list never flashes.
if (savedMobileDetail && savedCharId && isMobileViewport() && state.section === 'characters') {
   splitContainer.classList.add('mobile-detail-view');
}

render(); // paint immediately from local cache — no blocked UI

(async function loadAllFromCloud() {
   const [chars, npcs, lore, quests, sessions, loot, logs, treasury, rules] = await Promise.all([
      fetchAllCharactersRemote(),
      fetchAll('npcs'),
      fetchAll('lore'),
      fetchAll('quests'),
      fetchAll('sessions'),
      fetchAll('loot'),
      fetchAll('treasury_log'),
      fetchAll('treasury', null),   // no created_at column
      fetchAll('rules')
   ]);

   // Snapshot the pre-cloud character IDs so we can detect if the list changed.
   const preCloudCharIds = data.characters.map(c => c.id).join(',');

   if (chars !== null) data.characters = chars.map(remoteRowToCharacter);
   if (npcs !== null) data.npcs = npcs.map(r => ({ id: r.id, name: r.name || '', photo: r.portrait_url || null, location: r.location || '', affiliation: r.affiliation || '', notes: r.notes || '' }));
   if (lore !== null) data.lore = lore.map(r => ({ id: r.id, title: r.title || '', category: r.category || 'Other', content: r.content || '' }));
   if (quests !== null) data.quests = quests.map(r => ({ id: r.id, title: r.title || '', status: r.status || 'Active', description: r.description || '', reward: r.reward || '' }));
   if (sessions !== null) data.sessions = sessions.map(r => ({ id: r.id, date: r.date || '', title: r.title || '', recap: r.recap || '' }));
   if (loot !== null) data.treasury.loot = loot.map(r => ({ id: r.id, name: r.name || '', value: r.value || 0, description: r.description || '' }));
   if (logs !== null) data.treasury.log = logs.map(r => ({ id: r.id, date: r.date || '', change: r.change || 0, note: r.note || '' }));
   if (treasury !== null && treasury.length) data.treasury.gold = treasury[0].gold ?? data.treasury.gold;
   if (rules !== null) data.rules = rules.map(r => ({ id: r.id, title: r.title || '', content: r.content || '' }));

   saveData();

   // ── Flicker-free re-render after cloud sync ──────────────────────────────
   // If we're on the characters section and the set of character IDs didn't
   // change (the common case — just stats updating), avoid rebuilding the
   // entire left-side list DOM. Instead only refresh the detail panel so the
   // updated HP/stats show without any visible flicker.
   const postCloudCharIds = data.characters.map(c => c.id).join(',');
   if (state.section === 'characters' && postCloudCharIds === preCloudCharIds) {
      const activeId = state.selectedId.characters || (data.characters[0] && data.characters[0].id);
      if (activeId) renderCharacterDetail(activeId);
   } else {
      render(); // full re-render for other sections or when characters were added/removed
   }
   // Overlay live HP + ability scores from the D&D Beyond cache —
   // runs after the characters table is loaded so it can patch in place.
   syncStatsFromCache();
})();
