// The DOM HUD: health, armour, ammo, money, timer, scores, kill feed, banners, prompts,
// progress bar, hit marker, damage direction, crosshair, minimap, overlays and the buy
// menu. It never touches the simulation; main.js pushes numbers in and reads callbacks
// out. Setters skip unchanged values so the DOM is not churned every frame.
import { WEAPONS, BUY_ORDER } from './weapons.js';

const COPY = {
  start: {
    title: 'BREAKLINE',
    copy: 'Helios Relay, dusk. You are Vanguard: plant the Surge Charge at Site A or Site B, or eliminate the Sentinels. First team to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'BREAKLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

const BUY_ITEMS = [
  ...BUY_ORDER.map((key) => ({ kind: 'weapon', key, name: WEAPONS[key].name, price: WEAPONS[key].price, desc: WEAPONS[key].kind })),
  { kind: 'armor', key: 'ARMOR', name: 'Combat armour', price: 500, desc: 'halves damage taken' },
  { kind: 'frag', key: 'FRAG', name: 'Frag grenade', price: 300, desc: 'press G to throw' },
  { kind: 'smoke', key: 'SMOKE', name: 'Smoke grenade', price: 250, desc: 'press 4 to throw' },
];

// Schematic rectangles of the map's solid blocks, mirroring map.js, for the minimap.
const MAP_RECTS = [
  [-15, -4, 8, 8], [7, -4, 8, 8], [-5, -11.5, 4, 5], [1, -11.5, 4, 5],
  [-22.5, -14.1, 3.5, 2.2], [19, -14.1, 3.5, 2.2], [-6, 6.8, 12, 2.4],
];

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageDir = $('damage-dir');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorFill = $('armor-fill');
  const armorValue = $('armor-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const reloadHint = $('reload-hint');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerPhase = $('timer-phase');
  const scoreA = $('score-a');
  const scoreB = $('score-b');
  const pipsA = $('pips-a');
  const pipsB = $('pips-b');
  const roundLabel = $('round-label');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const prompt = $('prompt');
  const progressWrap = $('progress-wrap');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const objective = $('objective');
  const grenadeFrags = $('grenade-frags');
  const grenadeSmokes = $('grenade-smokes');
  const chargeChip = $('charge-chip');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyRows = $('buy-rows');
  const buyClose = $('buy-close');
  const muteChip = $('mute-chip');
  const minimap = $('minimap');
  const mapCtx = minimap.getContext('2d');

  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = '';
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = '';
  let lastScores = '';
  let lastObjective = '';
  let lastCharge = '';
  let lastGrenades = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let buyHandler = null;

  const buyButtons = new Map();
  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    row.innerHTML = `<div class="buy-info"><b></b><span></span></div><div class="buy-right"><span class="buy-price"></span><button type="button">Buy</button></div>`;
    row.querySelector('b').textContent = item.name;
    row.querySelector('span').textContent = item.desc;
    row.querySelector('.buy-price').textContent = `$${item.price}`;
    const button = row.querySelector('button');
    button.addEventListener('click', () => buyHandler && buyHandler(item.kind, item.key));
    buyRows.appendChild(row);
    buyButtons.set(item.key, { row, button });
  }

  function formatTime(seconds) {
    const clamped = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  }

  function drawMinimapStatic() {
    const ctx = mapCtx;
    ctx.fillStyle = '#241f18';
    ctx.fillRect(0, 0, minimap.width, minimap.height);
    ctx.fillStyle = '#4a4234';
    for (const [x, z, w, d] of MAP_RECTS) {
      ctx.fillRect((x + 24) * 3.5, (z + 18) * 3.5, w * 3.5, d * 3.5);
    }
    ctx.strokeStyle = '#6b6f75';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, minimap.width - 2, minimap.height - 2);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2a33c';
    ctx.fillText('A', 6 * 3.5, 6 * 3.5);
    ctx.fillStyle = '#2fd3c0';
    ctx.fillText('B', 42 * 3.5, 6 * 3.5);
  }
  drawMinimapStatic();

  return {
    setHealth(health, armor) {
      const hp = Math.max(0, Math.round(health));
      const ar = Math.max(0, Math.round(armor));
      if (hp === lastHealth && ar === lastArmor) return;
      lastHealth = hp;
      lastArmor = ar;
      healthFill.style.width = `${hp}%`;
      healthValue.textContent = String(hp);
      armorFill.style.width = `${ar * 2}%`;
      armorValue.textContent = String(ar);
      healthFill.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name, reloading) {
      const reserveText = Number.isFinite(reserve) ? `/ ${reserve}` : '/ ∞';
      if (mag === lastMag && reserveText === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserveText;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = reserveText;
      weaponName.textContent = name;
      ammoMag.parentElement.classList.toggle('empty', mag === 0);
      reloadHint.hidden = !reloading;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = `${formatTime(seconds)}|${phase}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = formatTime(seconds);
      timerPhase.textContent = phase;
    },
    setScores(aWins, dWins, round, winsNeeded) {
      const text = `${aWins}|${dWins}|${round}`;
      if (text === lastScores) return;
      lastScores = text;
      scoreA.textContent = String(aWins);
      scoreB.textContent = String(dWins);
      roundLabel.textContent = `Round ${round}`;
      const renderPips = (element, wins) => {
        element.innerHTML = '';
        for (let i = 0; i < winsNeeded; i += 1) {
          const pip = document.createElement('i');
          if (i < wins) pip.className = 'won';
          element.appendChild(pip);
        }
      };
      renderPips(pipsA, aWins);
      renderPips(pipsB, dWins);
    },
    setObjective(text) {
      if (text === lastObjective) return;
      lastObjective = text;
      objective.textContent = text;
    },
    setGrenades(frags, smokes) {
      const text = `${frags}|${smokes}`;
      if (text === lastGrenades) return;
      lastGrenades = text;
      grenadeFrags.textContent = `Frag ×${frags}`;
      grenadeSmokes.textContent = `Smoke ×${smokes}`;
    },
    setCharge(text) {
      if (text === lastCharge) return;
      lastCharge = text;
      chargeChip.textContent = text;
      chargeChip.hidden = text === '';
    },
    setMuted(muted) {
      muteChip.textContent = muted ? 'Muted (M)' : 'Sound on (M)';
    },
    killfeed(killer, victim, weapon, headshot, killerIsAttack) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      const killerSpan = document.createElement('b');
      killerSpan.textContent = killer;
      killerSpan.className = killerIsAttack ? 'att' : 'def';
      const victimSpan = document.createElement('b');
      victimSpan.textContent = victim;
      victimSpan.className = killerIsAttack ? 'def' : 'att';
      const middle = document.createElement('span');
      middle.textContent = headshot ? ` ☠ ${weapon} ` : ` ${weapon} `;
      entry.append(killerSpan, middle, victimSpan);
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => entry.remove(), 7000);
    },
    banner(title, sub, team, holdMs = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.className = `show ${team}`;
      clearTimeout(bannerTimer);
      if (Number.isFinite(holdMs)) bannerTimer = setTimeout(() => banner.classList.remove('show'), holdMs);
    },
    hideBanner() {
      banner.classList.remove('show');
    },
    prompt(text) {
      prompt.textContent = text ?? '';
      prompt.hidden = !text;
    },
    progress(label, fraction) {
      if (fraction === null || fraction === undefined) {
        progressWrap.hidden = true;
        return;
      }
      progressWrap.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    hitMarker(kill, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleRadians) {
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleRadians}rad)`;
      damageDir.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageDir.classList.remove('on'), 450);
    },
    setCrosshair(spread) {
      const gap = Math.round(4 + Math.min(0.09, spread) * 320);
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      overlayTitle.textContent = data.title ?? text.title;
      overlayCopy.textContent = data.copy ?? text.copy;
      playButton.textContent = data.action ?? text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    showBuy(show, state) {
      buyMenu.hidden = !show;
      if (!show || !state) return;
      buyMoney.textContent = `$${state.money}`;
      for (const item of BUY_ITEMS) {
        const { row, button } = buyButtons.get(item.key);
        let disabled = state.money < item.price;
        let label = 'Buy';
        if (item.kind === 'weapon' && state.owned.includes(item.key)) {
          disabled = true;
          label = 'Owned';
        }
        if (item.kind === 'weapon' && state.current === item.key) {
          disabled = true;
          label = 'In hand';
        }
        if (item.kind === 'armor' && state.armor >= 50) {
          disabled = true;
          label = 'Full';
        }
        if (item.kind === 'frag' && state.frags >= 2) {
          disabled = true;
          label = 'Max';
        }
        if (item.kind === 'smoke' && state.smokes >= 2) {
          disabled = true;
          label = 'Max';
        }
        button.disabled = disabled;
        button.textContent = label;
        row.classList.toggle('cant', disabled && label === 'Buy');
      }
    },
    onBuy(handler) {
      buyHandler = handler;
      buyClose.addEventListener('click', () => handler('close', ''));
    },
    isBuyOpen() {
      return !buyMenu.hidden;
    },
    drawMinimap(player, teammates, charge) {
      const ctx = mapCtx;
      drawMinimapStatic();
      const toMap = (x, z) => [(x + 24) * 3.5, (z + 18) * 3.5];
      if (charge && (charge.planted || charge.dropped)) {
        const [cx, cy] = toMap(charge.position.x, charge.position.z);
        ctx.fillStyle = '#ff5a3c';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      for (const mate of teammates) {
        if (!mate.alive) continue;
        const [mx, my] = toMap(mate.mover.body.position.x, mate.mover.body.position.z);
        ctx.fillStyle = '#f2a33c';
        ctx.beginPath();
        ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const [px, py] = toMap(player.mover.body.position.x, player.mover.body.position.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-player.mover.body.yaw);
      ctx.fillStyle = '#efe8dc';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
