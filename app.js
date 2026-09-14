    /**
     * app.js — Bingo Frontend
     * Communicates with Express backend; NO local cartela generation.
     */
    
    'use strict';
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    
    const API = 'https://za-bingo-5a7e.onrender.com';
    
    // ── State ─────────────────────────────────────────────────────────────────────
    const state = {
      player:           null,        // { id, name, balance, history }
      allCartelas:      [],          // fetched from /api/cartelas
      selectedRoom:     null,        // room id string
      selectedCartelas: [],          // cartelaId strings chosen in lobby
      activeRoomId:     null,        // room we've joined
      myCartelas:       [],          // cartela objects for current game
      calledNumbers:    [],          // current game's called numbers
      markedCells:      {},          // { cartelaId: Set<number|'FREE'> }
      gameStatus:       'waiting',
      pollTimer:        null,
      lastCalledCount:  0,
      bingoDetected:    {},          // { cartelaId: bool }
      autoMark: false,
soundOn: false,       // automatic marking OFF by default
    };
    
    // ── Utils ──────────────────────────────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    
    function letterFor(n) {
      if (n <= 15) return 'B';
      if (n <= 30) return 'I';
      if (n <= 45) return 'N';
      if (n <= 60) return 'G';
      return 'O';
    }
    function playNumberSound(number) {
  if (!state.soundOn) return;

  const letter = letterFor(number);
  const audio = new Audio(`audio/${letter}${number}.mp3`);

  audio.currentTime = 0;

  audio.play().catch(error => {
    console.log('Audio playback blocked:', error);
  });
}
function toggleSound() {
  state.soundOn = !state.soundOn;

  const btn = $('soundToggleBtn');

  if (btn) {
    btn.textContent = state.soundOn
      ? '🔊 SOUND: ON'
      : '🔇 SOUND: OFF';

    btn.classList.toggle('off', !state.soundOn);
  }
}

window.toggleSound = toggleSound;

    
    function uid() {
      return 'player_' + Math.random().toString(36).slice(2, 10);
    }
    
    function toast(msg, type = 'info') {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      const icons = { success: '✅', error: '❌', info: 'ℹ️' };
      el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
      $('toastContainer').appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }
    
    async function apiFetch(path, opts = {}) {
      const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API error');
      return data;
    }
    
    // ── Persistence ───────────────────────────────────────────────────────────────
    function saveLocal(key, val) {
      try { localStorage.setItem(`bingo_${key}`, JSON.stringify(val)); } catch {}
    }
    function loadLocal(key) {
      try { return JSON.parse(localStorage.getItem(`bingo_${key}`)); } catch { return null; }
    }
    
    // ── Navigation ────────────────────────────────────────────────────────────────
    function showPage(name) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
      $(`page-${name}`).classList.add('active');
      $(`page-${name}`).style.display = 'block';
      document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === name);
      });
        if (name === 'profile') renderProfile();
      if (name === 'history') renderHistory();
      if (name === 'lobby')   refreshRooms();
      if (name === 'game' || name === 'cartelas') {
      $('navTabs').style.display = 'none';
      $('playerHud').style.display = 'none';
      document.querySelector('header').style.display = 'none';
      document.querySelector('.app').classList.add('game-mode');
    
      renderMyCartelas();
    } else {
      $('navTabs').style.display = 'flex';
      $('playerHud').style.display = 'flex';
      document.querySelector('header').style.display = 'flex';
      document.querySelector('.app').classList.remove('game-mode');
    }
    }
    
    // ── Setup ─────────────────────────────────────────────────────────────────────
    
    
    async function initApp() {
  updateHUD();
  $('navTabs').style.display = 'flex';
  $('playerHud').style.display = 'flex';

  // Check if player was already inside a game
  const activeGame = loadLocal('activeGame');

  if (activeGame?.roomId && activeGame?.cartelaIds?.length) {
    try {
      const data = await apiFetch(`/api/game/${activeGame.roomId}`);
      const game = data.game;
      // Make sure cartelas are loaded before restoring
if (!state.allCartelas.length) {
  await loadCartelas();
}

      // Player is still inside this game
      const me = (game.players || []).find(
        p => String(p.id) === String(state.player.id)
      );

      if (me) {
        state.activeRoomId = activeGame.roomId;
        state.selectedRoom = activeGame.roomId;

        state.myCartelas = state.allCartelas.filter(
          c => activeGame.cartelaIds.includes(c.id)
        );

        state.markedCells = {};
        state.bingoDetected = {};

        for (const c of state.myCartelas) {
          state.markedCells[c.id] = new Set(['FREE']);
        }

        showPage('game');
        buildCalledGrid();
        renderMyCartelas();
        applyGameState(game);
        startGamePoll();

        return;
      }
    } catch (e) {
      console.log('No active game to restore');
    }

    // Saved game is no longer active
    localStorage.removeItem('bingo_activeGame');
  }

  // Normal lobby
  showPage('lobby');
  startLobbyPoll();

  loadCartelas();
}
    
    function updateHUD() {
      if (!state.player) return;
      $('hudName').textContent = state.player.name;
      $('hudBalance').textContent = `${state.player.balance} Br`;
    }
    
    // ── Cartelas (fetched once) ───────────────────────────────────────────────────
    async function loadCartelas() {
      try {
        const data = await apiFetch('/api/cartelas');
        state.allCartelas = data.cartelas;
        renderCartelaGrid();
      } catch (e) { toast('Failed to load cartelas: ' + e.message, 'error'); }
    }
    
    function renderCartelaGrid(reservedIds = []) {
      const reserved = new Set(reservedIds);
      const grid     = $('cartelaGrid');
      grid.innerHTML  = '';
      for (const c of state.allCartelas) {
        const el = document.createElement('div');
        el.className = 'cartela-item';
        el.textContent = c.number;
        el.dataset.id  = c.id;
        if (reserved.has(c.id)) el.classList.add('reserved');
        if (state.selectedCartelas.includes(c.id)) el.classList.add('selected');
        el.addEventListener('click', () => toggleCartela(c.id, el));
        grid.appendChild(el);
      }
    }
    
    function toggleCartela(id, el) {
      if (el.classList.contains('reserved')) return;
      const idx = state.selectedCartelas.indexOf(id);
      if (idx === -1) {
        if (state.selectedCartelas.length >= 4) {
          toast('Max 4 cartelas per game', 'error'); return;
        }
        state.selectedCartelas.push(id);
        el.classList.add('selected');
      } else {
        state.selectedCartelas.splice(idx, 1);
        el.classList.remove('selected');
      }
      $('selectedCount').textContent = `${state.selectedCartelas.length} cartela${state.selectedCartelas.length !== 1 ? 's' : ''} selected`;
     $('joinBtn').disabled = state.selectedCartelas.length === 0 || !state.selectedRoom;

renderSelectedCartelaPreview();
}
function renderSelectedCartelaPreview() {
  const container = $('selectedCartelaPreview');
  if (!container) return;

  container.innerHTML = '';

  for (const id of state.selectedCartelas) {
    const cartela = state.allCartelas.find(c => c.id === id);
    if (!cartela) continue;

    const card = document.createElement('div');
    card.className = 'selected-cartela-preview';

    card.innerHTML = `
      <div class="preview-title">Cartela ${cartela.number}</div>
      <div class="preview-grid">
        ${cartela.grid.flat().map(value => `
          <div class="preview-cell">${value}</div>
        `).join('')}
      </div>
    `;

    container.appendChild(card);
  }
}

    
// ── Rooms ──────────────
    let lobbyPollInterval = null;
    let countdownTimer = null;
    let activeCountdownStart = null;
    
    function startSharedCountdown(countdownStart, seconds = 30) { 
    if (activeCountdownStart === countdownStart && countdownTimer) {
  return;
}

activeCountdownStart = countdownStart;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  const update = () => {
    const elapsed = (Date.now() - countdownStart) / 1000;
    const remaining = Math.max(0, seconds - elapsed);
    const display = `${Math.ceil(remaining)}s`;

    const cartela = $('cartelaCountdown');
    if (cartela) cartela.textContent = display;

    const status = $('infoStatus');
    if (status) status.textContent = `Starting… ${display}`;

    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  };

  update();
  countdownTimer = setInterval(update, 250);
}
    
    function startCartelaCountdown(room) {
  if (room.status !== 'countdown' || !room.countdownStart) {
    $('cartelaCountdown').textContent = '—';
    return;
  }

  startSharedCountdown(
    room.countdownStart,
    room.countdownSeconds || 30
  );
}
    
      
    
    function startLobbyPoll() {
      refreshRooms();
      lobbyPollInterval = setInterval(refreshRooms, 4000);
    }
    
    async function refreshRooms() {
      try {
        const data = await apiFetch('/api/rooms');
        renderRoomCards(data.rooms);
        // Update reserved cartelas for selected room
        if (state.selectedRoom) {
      const room = data.rooms.find(r => r.id === state.selectedRoom);
    
      if (room) {
        // Update Cartela Selection status bar with LIVE room data
        $('cartelaPlayers').textContent = room.playerCount || 0;
        $('cartelaPot').textContent = `${Math.floor((room.pot || 0) * 0.80)} Br`;
    
        startCartelaCountdown(room);
    
        // Update reserved cartelas
        const reserved = (room.players || [])
      .flatMap(p => p.cartelaIds || [])
      .map(String);
    
    // Remove any cartela from our selection if another player took it
    state.selectedCartelas = state.selectedCartelas.filter(
      id => !reserved.includes(String(id))
    );
    
    renderCartelaGrid(reserved);
      }
    }
      } catch {}
    }
    
    function renderRoomCards(rooms) {
      const container = $('roomCards');
      container.innerHTML = '';
    
      for (const room of rooms) {
        const el = document.createElement('div');
    
        el.className = `room-card room-${room.entryFee}${
          state.selectedRoom === room.id ? ' selected' : ''
        }`;
    
        el.dataset.id = room.id;
    
        const statusClass = `status-${room.status}`;
    
        let statusText = {
          waiting: 'Waiting',
          countdown: 'ሊጀመር',
          playing: 'ተጀምሯል',
          winner: 'አልቋል'
        }[room.status] || room.status;
    
        // Show live countdown on the room card
        if (room.status === 'countdown' && room.countdownStart) {
          const elapsed = Math.floor(
            (Date.now() - room.countdownStart) / 1000
          );
    
          const remaining = Math.max(
            0,
            (room.countdownSeconds || 30) - elapsed
          );
    
          statusText = `ሊጀመር · ${remaining}s`;
        }
    
        el.innerHTML = `
          <div class="room-card-header">
      <div class="room-card-name">${room.name}</div>
    
      <div class="sapphire-gem ${room.id === '5br' ? 'hot' : ''}">
        ${room.id === '5br' ? '◆ HOT JOIN' : 'JOIN →'}
      </div>
    </div>
    
          <div class="room-meta">
            <span>👥 ${room.playerCount} ተጫዋች</span>
            <span>💰 ደራሽ: ${Math.floor((room.pot || 0) * 0.80)} Br</span>
            <span class="room-status-badge ${statusClass}">
              ${statusText}
            </span>
          </div>
        `;
    
        if (room.status === 'playing' || room.status === 'winner') {
          el.classList.add('locked');
    
          el.addEventListener('click', () => {
            toast('ጨዋታ ተጀምሯል', 'error');
          });
        } else {
          el.addEventListener('click', () => selectRoom(room, el));
        }
    
        container.appendChild(el);
      }
    }
    
    
    function selectRoom(room, el) {
      state.selectedRoom = room.id;
      $('cartelaPlayers').textContent = room.playerCount || 0;
    $('cartelaPot').textContent = `${Math.floor((room.pot || 0) * 0.80)} Br`;
    
    if (room.status === 'countdown' && room.countdownStart) {
      const elapsed = Math.floor((Date.now() - room.countdownStart) / 1000);
      const remaining = Math.max(
        0,
        (room.countdownSeconds || (room.countdownSeconds || 30)) - elapsed
      );
    
      $('cartelaCountdown').textContent = `${remaining}s`;
    } else {
      $('cartelaCountdown').textContent = '—';
    }
      // Highlight selected room
      document.querySelectorAll('.room-card')
        .forEach(c => c.classList.remove('selected'));
    
      el.classList.add('selected');
    
      // Hide Rooms
      $('page-lobby').style.display = 'none';
      $('page-lobby').classList.remove('active');
    
      // Show Cartelas
      showPage('cartelas');
    
      // Reset cartela selection
      state.selectedCartelas = [];
    
    const reserved = (room.players || [])
      .flatMap(p => p.cartelaIds || [])
      .map(String);
    
    renderCartelaGrid(reserved);
    
      $('selectedCount').textContent = '0 cartelas selected';
      $('joinBtn').disabled = true;
    }
    
// ── Join ──────────────────────────────────────────────────────────────────────
$('joinBtn').addEventListener('click', async () => {
  if (!state.selectedRoom) {
    toast('Select a room', 'error');
    return;
  }

  if (state.selectedCartelas.length === 0) {
    toast('Select at least 1 cartela', 'error');
    return;
  }

  const btn = $('joinBtn');

  const roomId = state.selectedRoom;
  const cartelaIds = [...state.selectedCartelas];

  btn.disabled = true;
  btn.textContent = 'Joining…';

// Show game UI immediately
showPage('game');

state.calledNumbers = [];
state.gameStartShown = false;
state.lastCalledCount = 0;

$('lastCalledNum').textContent = '—';
$('lastCalledHistory').innerHTML = '';

buildCalledGrid();

  state.activeRoomId = roomId;

  // Render selected cartelas immediately
  state.myCartelas = state.allCartelas.filter(
    c => cartelaIds.includes(c.id)
  );

  state.markedCells = {};
  state.bingoDetected = {};

  for (const c of state.myCartelas) {
    state.markedCells[c.id] = new Set(['FREE']);
  }

  renderMyCartelas();

  try {
    const data = await apiFetch(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: state.player.id,
        cartelaIds
      }),
    });

    const room = data.room;
    // Save active game so refresh can restore it
saveLocal('activeGame', {
  roomId,
  cartelaIds
});

    const fee = room.entryFee * cartelaIds.length;
    state.player.balance -= fee;
    updateHUD();

    applyGameState(room);

    toast(`Joined ${room.name}! Good luck 🍀`, 'success');

    if (lobbyPollInterval) {
      clearInterval(lobbyPollInterval);
      lobbyPollInterval = null;
    }

    startGamePoll();

  } catch (e) {

    state.activeRoomId = null;

    showPage('cartelas');

    btn.disabled = false;
    btn.textContent = 'Join Room →';

    toast(e.message, 'error');
  }
});
$('leaveGameBtn').addEventListener('click', async () => {
  if (!state.activeRoomId || !state.player?.id) return;

  const confirmed = confirm('Leave the game?');

  if (!confirmed) return;

  try {
    const endpoint =
      state.gameStatus === 'countdown'
        ? 'cancel-countdown'
        : 'leave-game';

    await apiFetch(`/api/rooms/${state.activeRoomId}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: state.player.id
      })
    });

    state.activeRoomId = null;
    state.myCartelas = [];
    state.calledNumbers = [];
    state.markedCells = {};
    state.gameStatus = 'waiting';

    showPage('lobby');

  } catch (e) {
    toast(e.message || 'Unable to leave game', 'error');
  }
});
    
    // ── Called-numbers grid — 5 vertical BINGO columns ─────────────────────────
    function toggleAutoMark() {
      state.autoMark = !state.autoMark;
    
      const btn = $('autoMarkBtn');
    
      if (btn) {
        btn.textContent = state.autoMark
          ? 'AUTO MARK: ON'
          : 'AUTO MARK: OFF';
    
        btn.classList.toggle('off', !state.autoMark);
      }
    }
    window.toggleAutoMark = toggleAutoMark;
    function buildCalledGrid() {
      const grid = $('calledGrid');
      grid.innerHTML = '';
    
      const letters = ['B', 'I', 'N', 'G', 'O'];
    
      // Create 5 vertical columns
      for (let col = 0; col < 5; col++) {
        const column = document.createElement('div');
        column.className = `called-column ${letters[col]}`;
    
        // B I N G O header
        const letter = document.createElement('div');
        letter.className = `called-column-letter ${letters[col]}`;
        letter.textContent = letters[col];
        column.appendChild(letter);
    
        // 15 numbers under each letter
        const start = col * 15 + 1;
        const end = start + 14;
    
        for (let n = start; n <= end; n++) {
          const el = document.createElement('div');
          el.className = 'cn-cell';
          el.id = `cn-${n}`;
          el.textContent = n;
          column.appendChild(el);
        }
    
        grid.appendChild(column);
      }
    }
    
    function updateCalledGrid(calledNumbers) {
      const prev = state.lastCalledCount;
      for (const n of calledNumbers) {
        const el = $(`cn-${n}`);
        if (el && !el.classList.contains('called')) {
          el.classList.add('called', letterFor(n));
        }
      }
    
      if (calledNumbers.length > prev) {
        const latest = calledNumbers[calledNumbers.length - 1];
        playNumberSound(latest);
        
    
    $('lastCalledWrap').style.visibility = 'visible';
    
    const numEl = $('lastCalledNum');
    numEl.textContent = `${letterFor(latest)} ${latest}`;
    numEl.style.color = `var(--${letterFor(latest)})`;
    
    // Show the previous 5 called numbers
    const historyEl = $('lastCalledHistory');
    
    const previousNumbers = calledNumbers
      .slice(0, -1)
      .slice(-5)
      .reverse();
    
    historyEl.innerHTML = previousNumbers
      .map(n => `<span class="${letterFor(n)}">${letterFor(n)}-${n}</span>`)
      .join('');
        numEl.style.animation = 'none';
        numEl.offsetHeight;
        numEl.style.animation = '';
        state.lastCalledCount = calledNumbers.length;
    
        // Auto-mark cartela cells
        autoMarkCartelas(calledNumbers);
      }
    }
    
    // ── My Cartelas ───────────────────────────────────────────────────────────────
    function renderMyCartelas() {
      const container = $('myCartelas');
      if (!state.myCartelas.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">🎴</div><div>Join a room to see your cartelas</div></div>';
        return;
      }
      container.innerHTML = '';
      for (const cartela of state.myCartelas) {
        container.appendChild(buildCartelaCard(cartela));
      }
    }
    
    const LETTERS = ['B', 'I', 'N', 'G', 'O'];
    
    function buildCartelaCard(cartela) {
      const card = document.createElement('div');
      card.className = 'cartela-card';
      card.id = `card-${cartela.id}`;
    
      card.innerHTML = `
        <div class="cartela-card-header">
          <div class="cartela-card-title">ካርቴላ #${cartela.number}</div>
        </div>
        <div class="bingo-grid" id="grid-${cartela.id}"></div>
        <button class="claim-bingo-btn visible" id="claimBtn-${cartela.id}" onclick="claimBingo('${cartela.id}')">
      BINGO
    </button>
      `;
    
      const gridEl = card.querySelector(`#grid-${cartela.id}`);
    
      // Number cells (row-major: cartela.grid = [[row0], [row1], …])
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const val = cartela.grid[r][c];
          const cell = document.createElement('div');
          cell.className = 'bingo-cell';
          cell.dataset.val = val;
          cell.dataset.row = r;
          cell.dataset.col = c;
    
          if (val === 'FREE') {
            cell.classList.add('free', 'marked');
            cell.textContent = '⭐';
          } else {
            cell.textContent = val;
            cell.addEventListener('click', () => toggleCell(cartela.id, cell, val));
          }
          gridEl.appendChild(cell);
        }
      }
    
      return card;
    }
    
    function toggleCell(cartelaId, cell, val) {
      if (state.gameStatus !== 'playing') return;
    
      // Check whether this number is currently marked
      // on the cartela that was clicked.
      const clickedMarked = state.markedCells[cartelaId];
    
      const shouldUnmark = clickedMarked.has(val);
    
      // Apply the same action to ALL of the player's cartelas
      for (const cartela of state.myCartelas) {
        const marked = state.markedCells[cartela.id];
        const gridEl = document.querySelector(`#grid-${cartela.id}`);
    
        if (!gridEl) continue;
    
        const cells = gridEl.querySelectorAll('.bingo-cell');
    
        for (const otherCell of cells) {
          if (Number(otherCell.dataset.val) === Number(val)) {
    
            if (shouldUnmark) {
              marked.delete(val);
              otherCell.classList.remove('marked', 'auto-marked');
            } else {
              marked.add(val);
              otherCell.classList.add('marked');
            }
    
          }
        }
    
        // Re-check BINGO for every affected cartela
        checkBingoLocal(cartela.id);
      }
    }
    
    function autoMarkCartelas(calledNumbers) {
    if (!state.autoMark) return;
      const called = new Set(calledNumbers);
      for (const cartela of state.myCartelas) {
        const marked = state.markedCells[cartela.id];
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 5; c++) {
            const val = cartela.grid[r][c];
            if (val === 'FREE') continue;
            if (called.has(val) && !marked.has(val)) {
              marked.add(val);
              const gridEl = document.querySelector(`#grid-${cartela.id}`);
              if (gridEl) {
                const cells = gridEl.querySelectorAll('.bingo-cell');
                // cells index: 5 header + r*5 + c (0-indexed in grid, but header is also in DOM via flex)
                // We stored row/col in dataset:
                cells.forEach(cell => {
                  if (Number(cell.dataset.row) === r && Number(cell.dataset.col) === c) {
                    cell.classList.add('auto-marked');
                  }
                });
              }
            }
          }
        }
        checkBingoLocal(cartela.id);
      }
    }
    
    // ── Local BINGO check ─────────────────────────────────────────────────────────
    function checkBingoLocal(cartelaId) {
      const cartela = state.myCartelas.find(c => c.id === cartelaId);
      if (!cartela) return;
      const marked = state.markedCells[cartelaId];
    
      const isMarked = (r, c) => {
        const v = cartela.grid[r][c];
        return v === 'FREE' || marked.has(v);
      };
    
      let bingo = false;
      for (let i = 0; i < 5; i++) {
        if ([0,1,2,3,4].every(j => isMarked(i, j))) { bingo = true; break; }
        if ([0,1,2,3,4].every(j => isMarked(j, i))) { bingo = true; break; }
      }
      if (!bingo && [0,1,2,3,4].every(i => isMarked(i, i))) bingo = true;
      if (!bingo && [0,1,2,3,4].every(i => isMarked(i, 4-i))) bingo = true;
      if (!bingo && isMarked(0,0) && isMarked(0,4) && isMarked(4,0) && isMarked(4,4)) bingo = true;
    
      const claimBtn = $(`claimBtn-${cartelaId}`);
      const indicator = $(`bingo-indicator-${cartelaId}`);
      if (bingo && !state.bingoDetected[cartelaId] && state.gameStatus === 'playing') {
        state.bingoDetected[cartelaId] = true;
        
        if (indicator) indicator.style.display = 'inline';
        // Highlight winning cells
        highlightBingoCells(cartela, isMarked);
        toast('🎉 BINGO detected! Click to claim!', 'success');
      } else if (!bingo) {
        state.bingoDetected[cartelaId] = false;
       
        if (indicator) indicator.style.display = 'none';
      }
    }
    
    function highlightBingoCells(cartela, isMarked) {
      const gridEl = document.querySelector(`#grid-${cartela.id}`);
      if (!gridEl) return;
      // rows
      for (let r = 0; r < 5; r++) {
        if ([0,1,2,3,4].every(c => isMarked(r, c))) {
          gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
            if (Number(cell.dataset.row) === r) cell.classList.add('bingo-hit');
          });
        }
      }
      // cols
      for (let c = 0; c < 5; c++) {
        if ([0,1,2,3,4].every(r => isMarked(r, c))) {
          gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
            if (Number(cell.dataset.col) === c) cell.classList.add('bingo-hit');
          });
        }
      }
      // diag
      if ([0,1,2,3,4].every(i => isMarked(i, i))) {
        gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
          if (cell.dataset.row === cell.dataset.col) cell.classList.add('bingo-hit');
        });
      }
      if ([0,1,2,3,4].every(i => isMarked(i, 4-i))) {
        gridEl.querySelectorAll('.bingo-cell').forEach(cell => {
          const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
          if (r + c === 4) cell.classList.add('bingo-hit');
        });
      }
    }
    
    // ── Claim BINGO (server) ──────────────────────────────────────────────────────
    async function claimBingo(cartelaId) {
      if (!state.activeRoomId) return;
    
      const btn = $(`claimBtn-${cartelaId}`);
    
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying…';
      }
    
      try {
        const data = await apiFetch(`/api/rooms/${state.activeRoomId}/bingo`, {
          method: 'POST',
          body: JSON.stringify({
            playerId: state.player.id,
            cartelaId
          }),
        });
    
        // Winner! The poll will pick it up, but show immediately
        console.log('WINNER DATA:', data.winner);
        handleWinner(data.winner);
    
      } catch (e) {
    
        // Invalid BINGO → burn this cartela
        if (e.message === 'Invalid BINGO') {
          if (btn) {
            btn.disabled = true;
            btn.textContent = '❌ INVALID BINGO';
            btn.classList.add('burned');
          }
          return;
        }
    
        // Other errors
        toast(e.message, 'error');
    
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'BINGO';
        }
      }
    }
    
    window.claimBingo = claimBingo;
    // ── Game Polling ──────────────────────────────────────────────────────────────
    function startGamePoll() {
      if (state.pollTimer) clearInterval(state.pollTimer);
      state.pollTimer = setInterval(pollGame, 1000);
    }
    
    async function pollGame() {
      if (!state.activeRoomId) return;
      try {
        const data = await apiFetch(`/api/game/${state.activeRoomId}`);
        const game = data.game;
        applyGameState(game);
      } catch {}
    }
    
    function applyGameState(game) {
      state.gameStatus  = game.status;
      state.calledNumbers = game.calledNumbers || [];
if (game.status === 'playing' && !state.gameStartShown) {
  state.gameStartShown = true;

  const overlay = $('gameStartOverlay');

  if (overlay) {
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');

    setTimeout(() => {
      overlay.classList.remove('show');
    }, 1800);
  }
}
     const leaveBtn = $('leaveGameBtn');

if (leaveBtn) {
  leaveBtn.style.display =
    game.status === 'countdown' || game.status === 'playing'
      ? 'block'
      : 'none';
} 
    
    
      $('infoRoomName').textContent = game.name;
if (game.status === 'countdown' && game.countdownStart) {
  startSharedCountdown(
    game.countdownStart,
    game.countdownSeconds || 30
  );
}
      



$('infoPot').textContent = `${Math.floor((game.pot || 0) * 0.80)} Br`;
$('infoPlayers').textContent = game.playerCount;
$('infoCalled').textContent = `${game.calledNumbers.length}/75`;
    
      // Player chips
      const list = $('gamePlayersList');
      list.innerHTML = '';
      for (const p of (game.players || [])) {
        const chip = document.createElement('div');
        chip.className = 'player-chip';
        chip.textContent = p.id === state.player.id ? `★ ${p.name}` : p.name;
        list.appendChild(chip);
      }
    
    
      // Called numbers grid
      updateCalledGrid(game.calledNumbers);
    
      // Winner state
      if (game.status === 'winner' && game.winner) {
    
        handleWinner(game.winner);
      }
    }
    
    function handleWinner(winner) {
      if (!winner) return;
      const isMe = winner.playerId === state.player?.id;
    
      $('popupWinnerName').textContent = winner.playerName;
      $('popupCartelaDetail').textContent =
        `Cartela #${winner.cartelaNumber} · ${winner.calledCount} numbers called`;
       // ── Show winning cartela with actual winning cells highlighted ──
const winnerGrid = $('winnerCartelaGrid');

if (winnerGrid && winner.cartelaGrid) {
  winnerGrid.innerHTML = '';

  const called = new Set(state.calledNumbers);

  // Determine which cells are marked on the winning cartela
  const isMarked = (r, c) => {
    const value = winner.cartelaGrid[r][c];

    if (value === 'FREE') return true;

    return called.has(value);
  };

  // Find the actual winning cells
  const winningCells = new Set();

  // Horizontal rows
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every(c => isMarked(r, c))) {
      for (let c = 0; c < 5; c++) {
        winningCells.add(`${r}-${c}`);
      }
    }
  }

  // Vertical columns
  for (let c = 0; c < 5; c++) {
    if ([0, 1, 2, 3, 4].every(r => isMarked(r, c))) {
      for (let r = 0; r < 5; r++) {
        winningCells.add(`${r}-${c}`);
      }
    }
  }

  // Diagonal ↘
  if ([0, 1, 2, 3, 4].every(i => isMarked(i, i))) {
    for (let i = 0; i < 5; i++) {
      winningCells.add(`${i}-${i}`);
    }
  }

  // Diagonal ↙
  if ([0, 1, 2, 3, 4].every(i => isMarked(i, 4 - i))) {
    for (let i = 0; i < 5; i++) {
      winningCells.add(`${i}-${4 - i}`);
    }
  }

  // Four corners
  if (
    isMarked(0, 0) &&
    isMarked(0, 4) &&
    isMarked(4, 0) &&
    isMarked(4, 4)
  ) {
    winningCells.add('0-0');
    winningCells.add('0-4');
    winningCells.add('4-0');
    winningCells.add('4-4');
  }

  // Build winner cartela
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const value = winner.cartelaGrid[r][c];

      const cell = document.createElement('div');
      cell.className = 'winner-cartela-cell';

      // FREE cell
      if (value === 'FREE') {
        cell.classList.add('free', 'marked');
        cell.textContent = 'FREE';
      } else {
        cell.textContent = value;

        // Normal called/marked number
        if (called.has(value)) {
          cell.classList.add('marked');
        }

        // Actual cells that created the BINGO
        if (winningCells.has(`${r}-${c}`)) {
          cell.classList.add('winner-bingo-hit');
        }
      }

      winnerGrid.appendChild(cell);
    }
  }
}
      $('popupAmount').textContent =
        isMe
          ? `+${winner.amount} Br 🎉`
          : `${winner.playerName} won ${winner.amount} Br`;
    
      $('popupAmount').style.color = 'var(--green)';
    
      $('winnerOverlay').classList.add('visible');
    
      // Return to Rooms after 5 seconds
      setTimeout(() => {
        $('winnerOverlay').classList.remove('visible');
    
        // Reset game state
        state.activeRoomId     = null;
        state.myCartelas       = [];
        state.calledNumbers    = [];
        state.markedCells      = {};
        state.bingoDetected    = {};
        state.selectedCartelas = [];
        state.selectedRoom     = null;
        state.lastCalledCount  = 0;
        localStorage.removeItem('bingo_activeGame');
    
        clearInterval(state.pollTimer);
    
        // Refresh player balance from server
        refreshPlayer();
    
        // Return to Rooms
    showPage('lobby');
    renderCartelaGrid();
    
    // Restart live lobby updates
    startLobbyPoll();
    
    }, 5000);
    
      if (isMe) {
        state.player.balance += winner.amount;
        updateHUD();
        
      }
    }
    
    async function refreshPlayer() {
      try {
        const data = await apiFetch(`/api/player/${state.player.id}`);
        state.player = data.player;
        updateHUD();
      } catch {}
    }
    
    // ── Profile ───────────────────────────────────────────────────────────────────
    function renderProfile() {
      if (!state.player) return;
    
      const player = state.player;
    
      // Profile header
      const playerName = player.first_name || 'Player';
    
      $('profileAvatar').textContent =
        playerName[0]?.toUpperCase() || '😀';
    
      $('profileName').textContent =
        playerName;
    
      $('profileBalance').textContent =
        `${player.balance ?? 0} Br`;
    
      // Player information
      $('playerName').textContent =
        player.first_name || 'N/A';
    
      $('playerId').textContent =
        player.telegram_id || 'N/A';
    
      $('playerPhone').textContent =
        player.phone || 'N/A';
    
      $('playerUsername').textContent =
        player.username ? `@${String(player.username).replace(/^@/, '')}` : 'N/A';
    
      $('playerBalance').textContent =
        `${player.balance ?? 0} Br`;
    
      $('gamesPlayed').textContent =
        player.gamesPlayed ?? 0;
    
      $('gamesWon').textContent =
        player.gamesWon ?? 0;
    
      // History
      const history = player.history || [];
      const tbody = $('historyBody');
    
      if (!history.length) {
        tbody.innerHTML =
          '<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">No history yet</td></tr>';
        return;
      }
    
      tbody.innerHTML = '';
    
      for (const entry of [...history].reverse()) {
        const tr = document.createElement('tr');
    
        const isWin = Number(entry.amount) > 0;
    
        const date = entry.date
          ? new Date(entry.date).toLocaleDateString('en-ET', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : '—';
    
        tr.innerHTML = `
          <td>${entry.type === 'win' ? '🏆 Win' : '🎮 Join'}</td>
          <td>${entry.roomId || '—'}</td>
          <td class="${isWin ? 'amount-win' : 'amount-loss'}">
            ${isWin ? '+' : ''}${entry.amount ?? 0} Br
          </td>
          <td style="color:var(--muted);font-size:.8rem">${date}</td>
        `;
    
        tbody.appendChild(tr);
      }
    }
    
    function renderHistory() {
      if (!state.player) return;
    
      const history = state.player.history || [];
      const tbody = $('historyPageBody');
    
      if (!history.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">
              No history yet
            </td>
          </tr>
        `;
        return;
      }
    
      tbody.innerHTML = '';
    
      for (const entry of [...history].reverse()) {
        const tr = document.createElement('tr');
        const isWin = entry.amount > 0;
    
        const date = new Date(entry.date).toLocaleDateString('en-ET', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
    
        tr.innerHTML = `
          <td>${entry.type === 'win' ? 'Win' : 'Join'}</td>
          <td>${entry.roomId || '—'}</td>
          <td class="${isWin ? 'amount-win' : 'amount-loss'}">
            ${isWin ? '+' : ''}${entry.amount} Br
          </td>
          <td style="color:var(--muted);font-size:.8rem">${date}</td>
        `;
    
        tbody.appendChild(tr);
      }
    }
    
    // ── Nav ────────────────────────────────────────────────────────────────────────
    $('backToRoomsBtn').addEventListener('click', () => {
      showPage('lobby');
    
      state.selectedRoom = null;
      state.selectedCartelas = [];
    
      renderCartelaGrid();
    
      $('selectedCount').textContent = '0 cartelas selected';
      $('joinBtn').disabled = true;
    });
    document.querySelectorAll('.nav-tab').forEach(tab => {
      
      tab.addEventListener('click', () => showPage(tab.dataset.page));
    });
    
    // ── Auto-restore Telegram session ─────────────────────────────────────────────
    (async () => {
      const telegramUser = tg?.initDataUnsafe?.user;
    
      if (!telegramUser) {
        toast('Please open the game through Telegram', 'error');
        return;
      }
    
      const playerId = String(telegramUser.id);
      const playerName =
        telegramUser.first_name ||
        telegramUser.username ||
        'Player';
    
      try {
        const data = await apiFetch('/api/player', {
          method: 'POST',
          body: JSON.stringify({
      playerId,
      name: playerName,
      username: telegramUser.username || ''
    }),
        });
    
        state.player = data.player;
        initApp();
      } catch (e) {
        toast('Could not load your Telegram account: ' + e.message, 'error');
      }
    })();
    /* ─────────────────────────────
       BONUS LEADERBOARD
    ───────────────────────────── */
    
    const bonuses = {
    
      daily: [
        {
          place: 1,
          amount: 500
        },
        {
          place: 2,
          amount: 250
        },
        {
          place: 3,
          amount: 100
        }
      ],
    

    
    };
    
    
    function placeText(place) {
    
      if (place === 1) return "1ST PLACE";
      if (place === 2) return "2ND PLACE";
      if (place === 3) return "3RD PLACE";
    
      return place + "TH PLACE";
    }
    
    
    function medal(place) {
    
      if (place === 1) return "🥇";
      if (place === 2) return "🥈";
      if (place === 3) return "🥉";
    
      return place;
    }
    
    
    function showBonus(type, button) {
    
      document
        .querySelectorAll(".bonus-tab")
        .forEach(tab => {
          tab.classList.remove("active");
        });
    
      button.classList.add("active");
    
      const list = bonuses.daily;
    
      const title = "DAILY BONUS";
    
      let rows = "";
    
      list.forEach(item => {
    
        rows += `
    
          <div class="bonus-row">
    
            <div class="bonus-rank">
    
              <div class="medal">
                ${medal(item.place)}
              </div>
    
              <div class="rank-text">
                ${placeText(item.place)}
              </div>
    
            </div>
    
            <div class="bonus-amount">
              ${item.amount.toLocaleString()} Br
            </div>
    
          </div>
    
        `;
    
      });
    
      document.getElementById("bonusCard").innerHTML = `
    
        <div class="bonus-card-header">
    
          <div class="bonus-card-title">
            ${title}
          </div>
    
          <div class="place-count">
            ${list.length} PLACES
          </div>
    
        </div>
    
        ${rows}
    
        <div class="bonus-note">
          የቦነስ ሽልማቶች በደረጃ ላይ ተመስርቶ የሚሰጥ ይሆናል ።.
        </div>
    
      `;
      loadTournamentLeaderboard(type);
    }
    
    
    /* BONUS TAB EVENTS */
    
    document
      .querySelectorAll(".bonus-tab")
      .forEach(button => {
    
        button.addEventListener("click", () => {
    
          showBonus(
            button.dataset.bonusType,
            button
          );
    
        });
    
      });
    
    
    /* DEFAULT BONUS */
    
    const defaultBonusTab =
      document.querySelector(
        '.bonus-tab[data-bonus-type="daily"]'
      );
    
    if (defaultBonusTab) {
    
      showBonus(
        "daily",
        defaultBonusTab
      );
    
    }
function renderTournamentLeaderboard(players = [], type = 'daily') {

  const leaderboard =
    document.getElementById('tournamentLeaderboard');

  const playerCount =
    document.getElementById('tournamentPlayerCount');

  if (!leaderboard || !playerCount) return;

  const topPlayers = Array.isArray(players)
    ? players
        .filter(player => player && Number(player.wins || 0) > 0)
        .sort((a, b) =>
          Number(b.wins || 0) - Number(a.wins || 0)
        )
        .slice(0, 10)
    : [];

  playerCount.textContent =
    `${topPlayers.length} PLAYERS`;

  if (topPlayers.length === 0) {
    leaderboard.innerHTML = `
      <div class="tournament-empty">
        NO PLAYERS YET
      </div>
    `;
    return;
  }

  leaderboard.innerHTML = topPlayers.map((player, index) => {

    const place = index + 1;

    let medal = place;

    if (place === 1) medal = '🥇';
    if (place === 2) medal = '🥈';
    if (place === 3) medal = '🥉';

    return `
      <div class="tournament-row">

        <div class="tournament-rank">
          ${medal}
        </div>

        <div class="tournament-player">
          ${player.name || 'Player'}
        </div>

        <div class="tournament-wins">
          ${Number(player.wins || 0)} wins
        </div>

      </div>
    `;

  }).join('');
}
async function loadTournamentLeaderboard(type = 'daily') {

  try {

    const data = await apiFetch(
      `/api/tournament/leaderboard?type=${type}`
    );

    if (!data || !data.success) {
      console.error('Leaderboard API failed:', data);
      return;
    }

    renderTournamentLeaderboard(
      Array.isArray(data.leaderboard)
        ? data.leaderboard
        : [],
      type
    );

  } catch (e) {

    console.error(
      'Leaderboard loading error:',
      e
    );

  }
}