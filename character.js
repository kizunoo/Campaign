/* ============================================================
   Playable header character.
   Click the little soldier in the header to take control. While
   controlled:
     A / D or ←/→   move
     W / Space      jump
     S              hold to block
     J              attack 1
     K              attack 2
     H              hurt reaction (just for fun)
     X              death animation (he gets back up after)
     Esc            let go of him
   Click him again, click elsewhere, or press Esc to release —
   he keeps strolling from exactly where you left him, instead of
   snapping back to the start.
   ============================================================ */

(function () {
   const walker = document.getElementById('headerWalker');
   const sprite = document.getElementById('headerWalkerSprite');
   const header = document.querySelector('.site-header');
   if (!walker || !sprite || !header) return;

   const SPRITE_SIZE = 96;
   const MOVE_SPEED = 240; // px / second, manual control
   const AUTO_SPEED = 55;  // px / second, idle auto-stroll

   const ACTION_MS = {
      attack1: 450,
      attack2: 450,
      hurt: 350,
      jump: 600,
      death: 1000
   };

   let manual = false;
   let x = -SPRITE_SIZE; // left position in px — single source of truth, always
   let facing = 1;       // 1 = right, -1 = left
   let action = null;    // 'attack1' | 'attack2' | 'jump' | 'hurt' | 'death' | null
   let actionTimer = null;
   let dead = false;
   let lastTs = null;

   const keys = new Set();
   let currentAnim = 'walk';

   function setSpriteAnim(name) {
      if (currentAnim === name) return;
      currentAnim = name;
      sprite.className = 'header-walker-sprite anim-' + name;
   }

   function manualBounds() {
      return { min: 0, max: Math.max(0, header.clientWidth - SPRITE_SIZE) };
   }

   function enterManual() {
      if (manual) return;
      manual = true;
      dead = false;
      action = null;
      walker.classList.add('manual');
      const b = manualBounds();
      x = Math.min(Math.max(x, b.min), b.max); // clamp into the header if he was mid-stroll
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      document.addEventListener('click', onDocumentClick, true);
   }

   function exitManual() {
      if (!manual) return;
      manual = false;
      keys.clear();
      if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
      action = null;
      dead = false;
      walker.classList.remove('manual', 'jumping');
      facing = 1; // auto-stroll always heads right
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('click', onDocumentClick, true);
   }

   function onDocumentClick(e) {
      if (!walker.contains(e.target)) exitManual();
   }

   walker.addEventListener('click', (e) => {
      e.stopPropagation();
      if (manual) exitManual();
      else enterManual();
   });

   function startAction(name) {
      if (dead) return;
      action = name;
      if (name === 'jump') walker.classList.add('jumping');
      setSpriteAnim(name);
      if (actionTimer) clearTimeout(actionTimer);
      actionTimer = setTimeout(() => {
         walker.classList.remove('jumping');
         if (name === 'death') {
            dead = false; // get back up after a beat
            action = null;
         } else {
            action = null;
         }
      }, ACTION_MS[name] || 400);
      if (name === 'death') dead = true;
   }

   function onKeyDown(e) {
      if (!manual) return;
      const k = e.key.toLowerCase();

      if (k === 'escape') { exitManual(); return; }
      if (dead) return;

      if (['a', 'd', 'w', 's', 'arrowleft', 'arrowright', ' '].includes(k)) {
         e.preventDefault();
      }

      keys.add(k);
      if (e.repeat) return;

      if ((k === 'w' || k === ' ') && action !== 'jump') {
         startAction('jump');
      } else if (k === 'j' && !action) {
         startAction('attack1');
      } else if (k === 'k' && !action) {
         startAction('attack2');
      } else if (k === 'h' && !action) {
         startAction('hurt');
      } else if (k === 'x' && !action) {
         startAction('death');
      }
   }

   function onKeyUp(e) {
      keys.delete(e.key.toLowerCase());
   }

   function isHeld(...names) {
      return names.some((n) => keys.has(n));
   }

   function tickManual(dt) {
      const blocking = isHeld('s') && !action;
      const movingLeft = isHeld('a', 'arrowleft');
      const movingRight = isHeld('d', 'arrowright');
      const canMove = !dead && !blocking && !action;

      let moved = false;
      if (canMove && (movingLeft || movingRight)) {
         const dir = movingRight ? 1 : -1;
         facing = dir;
         const b = manualBounds();
         x = Math.min(Math.max(x + dir * MOVE_SPEED * dt, b.min), b.max);
         moved = true;
      }

      if (!action) {
         if (blocking) setSpriteAnim('block');
         else if (moved) setSpriteAnim('walk');
         else setSpriteAnim('idle');
      }
   }

   function tickAuto(dt) {
      x += AUTO_SPEED * dt;
      if (x > header.clientWidth) x = -SPRITE_SIZE; // loop back around, off-screen
      facing = 1;
      setSpriteAnim('walk');
   }

   function loop(ts) {
      if (lastTs === null) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      if (manual) tickManual(dt);
      else tickAuto(dt);

      walker.style.left = x + 'px';
      walker.classList.toggle('facing-left', facing < 0);

      requestAnimationFrame(loop);
   }

   requestAnimationFrame(loop);

   // Keep him inside the header if the window is resized mid-control.
   window.addEventListener('resize', () => {
      if (!manual) return;
      const b = manualBounds();
      x = Math.min(Math.max(x, b.min), b.max);
   });
})();
