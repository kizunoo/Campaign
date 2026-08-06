/* ============================================================
   Mobile navigation for the sheet.

   - Simplified View is the only mobile layout: the book-icon toggle
     is hidden via CSS (see the max-width: 900px block in
     dnd-sheet.css) and this script forces the sheet into Simplified
     View the moment the viewport goes narrow, the same way it would
     if the user had clicked that icon themselves — so there's no way
     back to the three-column Full Sheet on a phone.
   - The row of tab buttons (Abilities / Skills / Actions / …) opens
     as a bottom-sheet popup from the .mobile-tab-pill sitting under
     the character card, instead of the old header hamburger dropdown.
     #simpleTabNav is never moved in the DOM — it's the same element
     Full Sheet mode leaves completely alone on desktop — this script
     only ever toggles classes on it and repositions it with
     `position: fixed` from the mobile media queries in dnd-sheet.css,
     so the popup sheet IS #simpleTabNav, just visually relocated.
   - The pill's label text is kept in sync with whichever tab is
     active via a MutationObserver watching for .tab-active changes,
     so it never drifts out of sync no matter how the tab gets
     activated (click, resize-driven default, etc).

   Written standalone, independent of whatever wires up the actual
   tab-switching in simplified-mode.js: it only ever reads/writes
   classes (.tab-active, .view-toggle-active) and reacts to them via
   MutationObserver, so it keeps working no matter how that's
   implemented.
   ============================================================ */
(function () {
   const siteHeader = document.querySelector('.site-header');
   const pill = document.getElementById('mobileTabPill');
   const pillLabel = document.getElementById('mobileTabPillLabel');
   const sheetBackdrop = document.getElementById('mobileTabSheetBackdrop');
   const tabNav = document.getElementById('simpleTabNav');
   const viewToggleBtn = document.getElementById('viewToggleBtn');
   const simpleBtn = document.querySelector('#viewToggle [data-view="simplified"]');
   const BODY_LOCK_CLASS = 'mobile-sheet-open';
   if (!pill || !tabNav) return;

   function isMobileViewport() {
      return window.matchMedia('(max-width: 900px)').matches;
   }

   /* Keep --site-header-h in sync with the header's real height, same
      as updateHeaderHeightVar() in index.html's app.js — the popup
      sheet (and the page's own "Back to Characters" bar) are
      positioned off this var, so it needs to track the header exactly
      even as the title wraps or fonts finish loading. */
   function updateHeaderHeightVar() {
      if (!siteHeader) return;
      document.documentElement.style.setProperty('--site-header-h', siteHeader.getBoundingClientRect().height + 'px');
   }

   function isSimplifiedActive() {
      return !!simpleBtn && simpleBtn.classList.contains('view-toggle-active');
   }

   /* Reuses the exact same switch-over the book-icon button triggers
      (including its own fallback if simplified-mode.js isn't present)
      instead of duplicating that logic here. */
   function enforceMobileView() {
      if (isMobileViewport() && !isSimplifiedActive() && viewToggleBtn) {
         viewToggleBtn.click();
      }
   }

   function openTabSheet() {
      tabNav.classList.add('nav-open');
      if (sheetBackdrop) sheetBackdrop.classList.add('open');
      pill.setAttribute('aria-expanded', 'true');
      pill.classList.add('is-open');
      document.body.classList.add(BODY_LOCK_CLASS);
   }

   function closeTabSheet() {
      tabNav.classList.remove('nav-open');
      if (sheetBackdrop) sheetBackdrop.classList.remove('open');
      pill.setAttribute('aria-expanded', 'false');
      pill.classList.remove('is-open');
      document.body.classList.remove(BODY_LOCK_CLASS);
   }

   function toggleTabSheet() {
      if (tabNav.classList.contains('nav-open')) closeTabSheet();
      else openTabSheet();
   }

   pill.addEventListener('click', toggleTabSheet);
   if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeTabSheet);

   document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTabSheet();
   });

   /* Picking a tab from the sheet closes it back up. */
   tabNav.addEventListener('click', (e) => {
      if (e.target.closest('.tab-btn')) closeTabSheet();
   });

   window.addEventListener('resize', () => {
      updateHeaderHeightVar();
      enforceMobileView();
      if (!isMobileViewport()) closeTabSheet();
   });

   /* ---- Keep the pill label synced with whichever tab is active ----
      Independent of simplified-mode.js's own logic: just watches the
      DOM for .tab-active moving between buttons and copies its text,
      so it stays correct regardless of what triggered the change. */
   function syncPillLabel() {
      const active = tabNav.querySelector('.tab-btn.tab-active');
      if (active && pillLabel) pillLabel.textContent = active.textContent.trim();
   }

   const tabObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
         if (m.type === 'attributes' && m.attributeName === 'class') {
            syncPillLabel();
            return;
         }
      }
   });
   tabNav.querySelectorAll('.tab-btn').forEach((btn) => {
      tabObserver.observe(btn, { attributes: true, attributeFilter: ['class'] });
   });

   function init() {
      updateHeaderHeightVar();
      enforceMobileView();
      syncPillLabel();
   }

   document.addEventListener('DOMContentLoaded', init);
   // In case this script runs after DOMContentLoaded has already fired.
   if (document.readyState !== 'loading') init();

   if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateHeaderHeightVar);
   }
})();
