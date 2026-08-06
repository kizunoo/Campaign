/* ==========================================================================
   Simplified View
   Adds a "Full Sheet / Simplified View" toggle. Simplified mode reorganizes
   the same panels dnd-sheet.js already fills in (nothing is duplicated or
   re-rendered) into 12 easy-to-browse tabs, aimed at players who just want
   a quick, uncluttered look at their character.

   How it works: every element that needs to move gets a tiny placeholder
   comment left in its original spot. Switching to Simplified View moves the
   real element into its new tab; switching back puts it right back where
   the placeholder is, so Full Sheet mode is always pixel-identical to how
   it looked before. dnd-sheet.js never knows this happened — it just keeps
   populating the same ids, wherever they currently live in the page.
   ========================================================================== */

(function () {
  'use strict';

  const MODE_KEY = 'dnd-sheet-view-mode';
  const el = (id) => document.getElementById(id);

  // Which real elements move into which Simplified tab. Order matters —
  // it's also the order they get restored in on the way back.
  const MOVES = [
    { target: 'simpleTabAbilities', selector: '#abilityBoxes' },
    { target: 'simpleTabAbilities', selector: '#panelSavingThrows' },
    { target: 'simpleTabAbilities', selector: '#panelPassiveSenses' },
    { target: 'simpleTabSkills', selector: '#panelSkills' },
    { target: 'simpleTabActions', selector: '[data-tab-content="actions"]' },
    { target: 'simpleTabInventory', selector: '[data-tab-content="inventory"]' },
    { target: 'simpleTabSpells', selector: '[data-tab-content="spells"]' },
    { target: 'simpleTabDefenses', selector: '#chipSpeed' },
    { target: 'simpleTabDefenses', selector: '#panelDefenses' },
    { target: 'simpleTabFeatures', selector: '[data-tab-content="features"]' },
    { target: 'simpleTabProficiencies', selector: '#panelProficiencies' },
    { target: 'simpleTabBackground', selector: '[data-tab-content="background"]' },
    { target: 'simpleTabNotes', selector: '[data-tab-content="notes"]' },
    { target: 'simpleTabExtras', selector: '[data-tab-content="extras"]' }
  ];

  let moves = null; // resolved lazily so this still works if the script loads early

  function resolveMoves() {
    if (moves) return moves;
    moves = MOVES.map((m) => ({ ...m, node: document.querySelector(m.selector), placeholder: null, wasTabActive: false }))
      .filter((m) => m.node);
    return moves;
  }

  function enterSimplified() {
    resolveMoves().forEach((m) => {
      if (!m.placeholder) {
        m.placeholder = document.createComment('simplified-mode-slot: ' + m.selector);
        m.node.parentNode.insertBefore(m.placeholder, m.node);
      }
      // The six raw [data-tab-content] panes are hidden by dnd-sheet.css
      // unless they carry .tab-active — force it on since visibility inside
      // Simplified mode is controlled by the *outer* .simple-pane instead.
      if (m.node.classList.contains('tab-content')) {
        m.wasTabActive = m.node.classList.contains('tab-active');
        m.node.classList.add('tab-active');
      }
      el(m.target).appendChild(m.node);
    });
    document.querySelector('.cs-body').classList.add('simple-mode-hidden');
    el('simpleShell').classList.add('is-active');
  }

  function exitSimplified() {
    resolveMoves().slice().reverse().forEach((m) => {
      if (m.placeholder && m.placeholder.parentNode) {
        m.placeholder.parentNode.insertBefore(m.node, m.placeholder);
        m.placeholder.remove();
        m.placeholder = null;
      }
      if (m.node.classList.contains('tab-content') && !m.wasTabActive) {
        m.node.classList.remove('tab-active');
      }
    });
    el('simpleShell').classList.remove('is-active');
    document.querySelector('.cs-body').classList.remove('simple-mode-hidden');
  }

  // ---- Simplified tab switching ----
  function initSimpleTabs() {
    const nav = el('simpleTabNav');
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      showSimpleTab(btn);
    });
  }

  function showSimpleTab(btn) {
    const nav = el('simpleTabNav');
    nav.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('tab-active'));
    btn.classList.add('tab-active');

    const targetId = btn.dataset.simpleTarget;
    document.querySelectorAll('#simpleShell .simple-pane').forEach((pane) => {
      pane.classList.toggle('simple-pane-active', pane.id === targetId);
    });
  }

  // ---- Full Sheet / Simplified View toggle ----
  let isSimplified = false;

  function applyMode(mode) {
    const wantSimplified = mode === 'simplified';
    if (wantSimplified === isSimplified) return; // nothing to do (e.g. initial 'full' load)

    const toggle = el('viewToggle');
    toggle.querySelectorAll('.view-toggle-btn').forEach((b) => b.classList.toggle('view-toggle-active', b.dataset.view === mode));
    document.documentElement.classList.toggle('simple-mode-active', wantSimplified);
    if (wantSimplified) enterSimplified();
    else exitSimplified();
    isSimplified = wantSimplified;
    localStorage.setItem(MODE_KEY, mode);
  }

  function initToggle() {
    const toggle = el('viewToggle');
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-toggle-btn');
      if (!btn) return;
      applyMode(btn.dataset.view);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initToggle();
    initSimpleTabs();
    applyMode(localStorage.getItem(MODE_KEY) || 'full');
  });
})();
