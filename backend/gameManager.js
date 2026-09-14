'use strict';
function getEthiopiaDailyKey() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const getPart = type =>
    Number(parts.find(p => p.type === type)?.value || 0);

  let year = getPart('year');
  let month = getPart('month');
  let day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');

  // Before 10:30 PM Ethiopia time belongs to the previous daily period.
  if (hour < 22 || (hour === 22 && minute < 30)) {
    const previousDay = new Date(
      Date.UTC(year, month - 1, day)
    );

    previousDay.setUTCDate(
      previousDay.getUTCDate() - 1
    );

    year = previousDay.getUTCFullYear();
    month = previousDay.getUTCMonth() + 1;
    day = previousDay.getUTCDate();
  }

  return [
    year,
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

/**
 * gamesManager.js
 * Manages all 3 Bingo room states: waiting → countdown → playing → winner
 */

const ROOMS_CONFIG = [
  { id: '5br',  name: '5 Br Room',  entryFee: 5  },
  { id: '10br', name: '10 Br Room', entryFee: 10 },
  { id: '20br', name: '20 Br Room', entryFee: 20 },
];

const COUNTDOWN_SECONDS = 30;
const DRAW_INTERVAL_MS  = 4000;
const WINNER_SHARE = 0.80;

// Starting balance for each simulated player's account.
// This is only created once when the sim account does not exist.
const SIM_STARTING_BALANCE = 999999;

const SIMULATED_PLAYERS = [
  // ───── 5 BR GROUP: 1–20 ─────
  '@tame',
  '🤘',
  'ማሜ',
  'neqelu',
  'Rasta',
  'Mimi',
  'Mati',
  'ኢብሮ',
  'ትራምፕ',
  'lala',
  'Tare',
  'በሌ',
  'yoni',
  'Maje',
  'Yaaa',
  'Debela',
  'Taye',
  'Ggz',
  'Dave',
  'መካሽ',

  // ───── 10 BR GROUP: 21–40 ─────
  'cr7',
  'Dangote',
  '@mente',
  'Messi',
  'Runner',
  'Dawit',
  'Selam',
  'Hana',
  'Yonatan',
  'Bereket',
  'Natnael',
  'Abel',
  'Samrawit',
  'Teddy',
  'Michael',
  'Robel',
  'Kalkidan',
  'Meron',
  'Henok',
  'Sami',

  // ───── 20 BR GROUP: 41–60 ─────
  'Bini',
  'Kalki',
  'Micky',
  'Roni',
  'ሚካኤል',
  'ሳራ',
  'ዮሴፍ',
  'ሀና',
  'ብርሃኑ',
  'ማርታ',
  'ናትናኤል',
  'ሰላም',
  'Alex',
  'Danny',
  'Lucky',
  'King',
  'SamiBoy',
  'Winner',
  'Flash',
  'Boss'
];

// ─────────────────────────────────────────────
// TIME-BASED SIMULATOR SCHEDULE
// Ethiopia time: Africa/Addis_Ababa
// ─────────────────────────────────────────────

const SIMULATOR_SCHEDULES = {
'5br': [
  { start: '09:15', end: '09:20', counts: [8, 10, 11] },
  { start: '09:20', end: '11:25', counts: [12, 13, 14, 15] },
  { start: '11:25', end: '16:40', counts: [17, 18, 19, 20] },
  { start: '16:40', end: '23:45', counts: [17, 18, 19, 20] },
  { start: '23:45', end: '01:03', counts: [15, 16, 17] },
  { start: '01:03', end: '01:30', counts: [9, 10, 11] }
],

'10br': [
  { start: '11:11', end: '11:16', counts: [8, 10, 11] },
  { start: '11:16', end: '12:21', counts: [8, 10, 11] },
  { start: '12:21', end: '14:36', counts: [12, 13, 14] },
  { start: '14:36', end: '01:41', counts: [17, 18, 19, 20] },
  { start: '01:41', end: '02:56', counts: [17, 18, 19, 20] }
],

'20br': [
  { start: '18:45', end: '2:44', counts: [9, 10, 11] }
]
};

function getEthiopiaMinutes() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(
    parts.find(p => p.type === 'hour')?.value || 0
  );

  const minute = Number(
    parts.find(p => p.type === 'minute')?.value || 0
  );

  return hour * 60 + minute;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function isTimeInScheduleRange(now, start, end) {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);

  // Normal period, e.g. 08:35 → 10:20
  if (startMin < endMin) {
    return now >= startMin && now < endMin;
  }

  // Crosses midnight, e.g. 23:45 → 01:38
  return now >= startMin || now < endMin;
}

function getRoomSimulatorSchedule(roomId) {
  const schedule = SIMULATOR_SCHEDULES[roomId];

  if (!schedule) return null;

  const now = getEthiopiaMinutes();

  return schedule.find(period =>
    isTimeInScheduleRange(
      now,
      period.start,
      period.end
    )
  ) || null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function generateCartela() {
  const cols = [
    { letter: 'B', min: 1,  max: 15 },
    { letter: 'I', min: 16, max: 30 },
    { letter: 'N', min: 31, max: 45 },
    { letter: 'G', min: 46, max: 60 },
    { letter: 'O', min: 61, max: 75 },
  ];

  const grid = [];
  for (let col = 0; col < 5; col++) {
    const { min, max } = cols[col];
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    pool.sort(() => Math.random() - 0.5);
    grid.push(pool.slice(0, 5));
  }

  // Transpose to row-major [[row0], [row1], …] then set FREE center
  const rows = [];
  for (let r = 0; r < 5; r++) {
    rows.push([grid[0][r], grid[1][r], grid[2][r], grid[3][r], grid[4][r]]);
  }
  rows[2][2] = 'FREE';
  return rows;
}

function checkBingo(cartela, calledNumbers) {
  const called = new Set(calledNumbers);

  const marked = (r, c) => {
    const v = cartela[r][c];
    return v === 'FREE' || called.has(v);
  };

  // rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => marked(r, c))) return true;
  }
  // columns
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => marked(r, c))) return true;
  }
  // diagonals
  if ([0,1,2,3,4].every(i => marked(i, i))) return true;
  if ([0,1,2,3,4].every(i => marked(i, 4-i))) return true;
  // 4 corners
  if (marked(0,0) && marked(0,4) && marked(4,0) && marked(4,4)) return true;

  return false;
}

// ── Room class ────────────────────────────────────────────────────────────────

class Room {
  constructor(config) {
    this.id       = config.id;
    this.name     = config.name;
    this.entryFee = config.entryFee;
    this.reset();
  }

reset() {
  this.status           = 'waiting';   // waiting | countdown | playing | winner
  this.players          = [];           // [{ id, name, balance }]
  this.playerCartelas   = {};           // { playerId: [cartelaObj, …] }
  this.burnedCartelas   = new Set();    // cartelas burned by invalid BINGO
  this.reservedCartelas = new Set();    // cartelaIds reserved for this room
  this.calledNumbers    = [];
  this.pot              = 0;
  this.winner           = null;         // { playerId, playerName, cartelaId, amount }
  this.countdownStart   = null;
  this._countdownTimer  = null;
  this._drawTimer       = null;
  this._gameStartTime   = null;
  this._simulatorScheduleKey = null;
}

// Public snapshot for API
toJSON() {
  return {
    id: this.id,
    name: this.name,
    entryFee: this.entryFee,
    status: this.status,
    playerCount: this.players.length,
    players: this.players.map(p => ({
  id: p.id,
  name: p.name,
  cartelaIds: (this.playerCartelas[p.id] || []).map(c => c.id)
})),
    calledNumbers: this.calledNumbers,
    pot: this.pot,
    winner: this.winner,
    countdownStart: this.countdownStart,
    countdownSeconds: COUNTDOWN_SECONDS,
    countdownEnd: this.countdownEnd,
  };
}
}
// ── GamesManager ─────────────────────────────────────────────────────────────

class GamesManager {
  constructor(db) {
    this.db = db;
this.rooms = {};
this.simulatorsEnabled = {
  '5br': true,
  '10br': true,
  '20br': true
};
this._cartelaCache = null;
this._playerCache = new Map();

    for (const cfg of ROOMS_CONFIG) {
      this.rooms[cfg.id] = new Room(cfg);
      
    }

// ─────────────────────────────────────────────
// AUTOMATIC TIME-BASED SIMULATOR CHECK
// Checks every 30 seconds using Ethiopia time.
// ─────────────────────────────────────────────

this._simulatorScheduler = setInterval(() => {

  for (const roomId of ['5br', '10br', '20br']) {

    const room = this.rooms[roomId];

    if (!room || room.status !== 'waiting') {
      continue;
    }

    this.addSimulatedPlayers(roomId).catch(err => {
      console.error(
        `❌ Simulator scheduler error for ${roomId}:`,
        err.message
      );
    });
  }

}, 30 * 1000);
}
  // ── cartelas ──────────────────────────────────────────────────────────────

  async getCartelas() {
  if (this._cartelaCache) return this._cartelaCache;

  if (!this.db) {
    throw new Error('Firebase Realtime Database is not connected');
  }

  const snap = await this.db.ref('rooms/10br/cartelas').once('value');
  const data = snap.val();

  if (!data) {
    throw new Error('No cartelas found in Firebase Realtime Database');
  }

  this._cartelaCache = Object.entries(data).map(([id, value]) => {
    const numbers = value.numbers;

    const grid = [];

    for (let r = 0; r < 5; r++) {
      grid.push([
        numbers.B[r],
        numbers.I[r],
        numbers.N[r] === 0 ? 'FREE' : numbers.N[r],
        numbers.G[r],
        numbers.O[r]
      ]);
    }

    return {
      id: String(id),
      number: Number(id),
      grid
    };
  });

  return this._cartelaCache;
}

  // ── player ────────────────────────────────────────────────────────────────

  async getOrCreatePlayer(playerId, name, username = '') {
  const key = String(playerId);

  // 1. Check memory cache first
  if (this._playerCache && this._playerCache.has(key)) {
    return {
      id: key,
      ...this._playerCache.get(key)
    };
  }

  if (this.db) {
    const ref = this.db.ref(`players/${key}`);
    const snap = await ref.once('value');

    // 2. Existing player
    if (snap.exists()) {
      const player = snap.val();

      if (!this._playerCache) {
        this._playerCache = new Map();
      }

      this._playerCache.set(key, player);

      return {
        id: key,
        ...player
      };
    }

    // 3. New player
    const player = {
      name,
      username: username || '',
      balance: 0,
      history: []
    };

    await ref.set(player);

    if (!this._playerCache) {
      this._playerCache = new Map();
    }

    this._playerCache.set(key, player);

    return {
      id: key,
      ...player
    };
  }

  // 4. Memory fallback
  if (!this._players) {
    this._players = {};
  }

  if (!this._players[key]) {
    this._players[key] = {
      id: key,
      name,
      username: username || '',
      balance: 100,
      history: []
    };
  }

  if (!this._playerCache) {
    this._playerCache = new Map();
  }

  this._playerCache.set(key, this._players[key]);

  return this._players[key];
}

  async updatePlayerBalance(playerId, delta, historyEntry) {



  // ─────────────────────────────────────────────
  // REAL PLAYER
  // ─────────────────────────────────────────────
  if (this.db) {

    const ref = this.db.ref(`players/${playerId}`);
    const snap = await ref.once('value');

    if (!snap.exists()) {
      throw new Error(`Player ${playerId} not found`);
    }

    const data = snap.val();

    const balance =
      Number(data.balance || 0) + Number(delta || 0);

    const history =
      [...(data.history || []), historyEntry];

    const updates = {
      balance,
      history
    };

    // ONLY increment gamesWon when the transaction is a win.
    // Do NOT increment gamesPlayed here.
    if (historyEntry?.type === 'win') {
      updates.gamesWon =
        Number(data.gamesWon || 0) + 1;
    }

await ref.update(updates);

// Keep player cache synchronized with Firebase
if (!this._playerCache) {
  this._playerCache = new Map();
}

this._playerCache.set(String(playerId), {
  ...data,
  ...updates
});

return {
  id: playerId,
  ...data,
  ...updates
};
}

// ─────────────────────────────────────────────
// MEMORY FALLBACK
// ─────────────────────────────────────────────
  if (this._players && this._players[playerId]) {

    const p = this._players[playerId];

    p.balance =
      Number(p.balance || 0) + Number(delta || 0);

    p.history.push(historyEntry);

    if (historyEntry?.type === 'win') {
      p.gamesWon =
        Number(p.gamesWon || 0) + 1;
    }

    return p;
  }

  throw new Error(`Player ${playerId} not found`);
}
  // ── join ──────────────────────────────────────────────────────────────────

  async joinRoom(roomId, player, cartelaIds) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'waiting' && room.status !== 'countdown') {
      throw new Error('Room is not accepting players right now');
    }
    if (room.players.find(p => p.id === player.id)) {
      throw new Error('Already in this room');
    }
    if (cartelaIds.length === 0 || cartelaIds.length > 4) {
      throw new Error('Select 1–4 cartelas');
    }

    // Reserve cartelas
    const cartelas = await this.getCartelas();
    const selected = [];
    for (const cid of cartelaIds) {
      if (room.reservedCartelas.has(cid)) throw new Error(`Cartela ${cid} already taken`);
      const c = cartelas.find(x => x.id === cid);
      if (!c) throw new Error(`Cartela ${cid} not found`);
      selected.push(c);
    }
    for (const c of selected) room.reservedCartelas.add(c.id);

    // Deduct fee (per cartela)
// ONE balance only: Main first, otherwise Bonus.
// Never split a single game fee between the two balances.
const totalFee = room.entryFee * cartelaIds.length;

const mainBalance = Number(player.balance || 0);
const bonusBalance = Number(player.referralBonusBalance || 0);

let paymentSource = null;

if (mainBalance >= totalFee) {
  // Main balance pays the entire fee
  await this.updatePlayerBalance(player.id, -totalFee, {
    type: 'join',
    roomId,
    amount: -totalFee,
    paymentSource: 'main',
    date: new Date().toISOString(),
  });

  paymentSource = 'main';

} else if (bonusBalance >= totalFee) {
  // Bonus balance pays the entire fee
  const playerRef = this.db.ref(`players/${player.id}`);

  await playerRef.update({
    referralBonusBalance: bonusBalance - totalFee
  });

  paymentSource = 'bonus';

} else {
  throw new Error('Insufficient balance');
}

room.players.push({
  id: String(player.id),
  name: player.name || `Player ${player.id}`,
  username: player.username || '',
  balance:
    paymentSource === 'main'
      ? mainBalance - totalFee
      : mainBalance,
  paymentSource
});
    room.playerCartelas[player.id] = selected;
    room.pot += totalFee;

    // Start the 30-second countdown when the second player joins
if (room.players.length === 2 && room.status === 'waiting') {
  this._startCountdown(room);
}

return room.toJSON();
  }

async addSimulatedPlayers(roomId = '5br') {
  const room = this.rooms[roomId];
    // MASTER SIMULATOR SWITCH
  if (this.simulatorsEnabled[roomId] === false) {
  console.log(`🛑 ${roomId}: simulators are OFF`);
  return;
}
  if (!room) throw new Error('Room not found');

  if (room.status !== 'waiting') return;

  const schedule = getRoomSimulatorSchedule(roomId);

  // 20 Br remains on the old system
  if (!schedule) {
  return;
}

  // No simulators scheduled at this time
  if (schedule.counts.length === 0) {
    console.log(
      `🤖 ${roomId}: no simulators scheduled right now`
    );
    return;
  }

  // Prevent the scheduler from adding another group
  // during the same waiting period.
  const scheduleKey =
    `${schedule.start}-${schedule.end}`;

  if (room._simulatorScheduleKey === scheduleKey) {
    return;
  }

  room._simulatorScheduleKey = scheduleKey;

  const cartelas = await this.getCartelas();

  // Pick the number for this game
  const playerCount =
    schedule.counts[
      Math.floor(
        Math.random() * schedule.counts.length
      )
    ];

  console.log(
    `🕐 ${roomId}: Ethiopia time schedule ` +
    `${schedule.start} → ${schedule.end}`
  );

  console.log(
    `🤖 ${roomId}: selected ${playerCount} simulated players`
  );

  // ─────────────────────────────────────────────
  // RANDOM NUMBER OF SIMULATED PLAYERS: 10–15
  // ─────────────────────────────────────────────
  

  // Randomly choose which simulated players participate
  const SIMULATOR_GROUPS = {
  '5br': SIMULATED_PLAYERS.slice(0, 20),
  '10br': SIMULATED_PLAYERS.slice(20, 40),
  '20br': SIMULATED_PLAYERS.slice(40, 60)
};

const roomPlayers = SIMULATOR_GROUPS[roomId] || [];

const players = [...roomPlayers];

players.sort(() => Math.random() - 0.5);

const selectedPlayers = players.slice(
  0,
  Math.min(playerCount, players.length)
);

  // ─────────────────────────────────────────────
  // RANDOM CARTELAS: 2–4 PER PLAYER
  // ─────────────────────────────────────────────
  for (let i = 0; i < selectedPlayers.length; i++) {

    // Random arrival delay: 0.5–1.5 seconds
    const delay = 500 + Math.floor(Math.random() * 1000);

    await new Promise(resolve => setTimeout(resolve, delay));

    // Stop if game has already started
    if (room.status === 'playing' || room.status === 'winner') {
      break;
    }

    const name = selectedPlayers[i];
    const originalIndex = SIMULATED_PLAYERS.indexOf(name);
    const playerId = `sim_${originalIndex + 1}`;

    // Prevent duplicate player
    if (room.players.some(p => p.id === playerId)) {
      continue;
    }

    // Each simulated player gets 2–4 cartelas
    const count = 2 + Math.floor(Math.random() * 3);

    // Get cartelas that are not already reserved
    const available = cartelas.filter(
      c => !room.reservedCartelas.has(c.id)
    );

    // Shuffle ALL available cartelas
    available.sort(() => Math.random() - 0.5);

    // Pick random cartelas from #1–#150
    const selected = available.slice(0, count);

    if (selected.length < count) {
      console.error(
        `❌ Not enough cartelas for ${name}`
      );
      break;
    }

    // Reserve selected cartelas
    selected.forEach(c => {
      room.reservedCartelas.add(c.id);
    });

// ─────────────────────────────────────────────
// CREATE / LOAD THE SIMULATED PLAYER ACCOUNT
// ─────────────────────────────────────────────
if (!this.db) {
  throw new Error('Firebase Realtime Database is not connected');
}

const simRef = this.db.ref(`players/${playerId}`);
const simSnap = await simRef.once('value');

let simAccount;

if (!simSnap.exists()) {
  // Create the simulated player account ONCE.
  simAccount = {
    name,
    username: '',
    balance: SIM_STARTING_BALANCE,
    gamesPlayed: 0,
    gamesWon: 0,
    history: [],
    isSimulated: true
  };

  await simRef.set(simAccount);

  console.log(
    `🤖 Created simulated account ${playerId} with balance ${SIM_STARTING_BALANCE}`
  );
} else {
  simAccount = simSnap.val();

  // Keep the name/current sim identity correct.
  await simRef.update({
    name,
    username: '',
    isSimulated: true
  });
}

// ─────────────────────────────────────────────
// DEDUCT THE SIM'S STAKE EXACTLY LIKE A REAL PLAYER
// ─────────────────────────────────────────────
const totalFee = room.entryFee * count;

if (Number(simAccount.balance || 0) < totalFee) {
  console.error(
    `❌ ${name} (${playerId}) has insufficient balance`
  );

  // Release the cartelas because the sim cannot afford them.
  selected.forEach(c => {
    room.reservedCartelas.delete(c.id);
  });

  continue;
}

const updatedSim = await this.updatePlayerBalance(
  playerId,
  -totalFee,
  {
    type: 'join',
    roomId: room.id,
    amount: -totalFee,
    paymentSource: 'main',
    date: new Date().toISOString()
  }
);

// ─────────────────────────────────────────────
// ADD SIM TO THE ROOM
// ─────────────────────────────────────────────
room.players.push({
  id: playerId,
  name,
  username: '',
  balance: Number(updatedSim.balance || 0),
  gamesWon: Number(updatedSim.gamesWon || 0),
  paymentSource: 'main',
  isSimulated: true
});

room.playerCartelas[playerId] = selected;

// The exact amount deducted from the sim account
// enters the game pot.
room.pot += totalFee;

    console.log(
      `🤖 ${name} joined ${room.id} with ${count} cartelas:`,
      selected.map(c => `#${c.number}`).join(', ')
    );

    // Start 30-second countdown when second player joins
    if (
      room.players.length === 2 &&
      room.status === 'waiting'
    ) {
      this._startCountdown(room);
    }
  }

  console.log(
    `🎮 ${room.id}: ${room.players.length} simulated/real players in game`
  );
}
// ── countdown → game ──────────────────────────────────────────────────────

_startCountdown(room) {
  room.status = 'countdown';

  // One server-generated countdown timestamp
  room.countdownStart = Date.now();
  room.countdownEnd = room.countdownStart + (COUNTDOWN_SECONDS * 1000);

  room._countdownTimer = setTimeout(() => {
    if (room.status === 'countdown') {
      this._startGame(room);
    }
  }, COUNTDOWN_SECONDS * 1000);
}

async cancelCountdown(roomId, playerId) {
  const room = this.rooms[roomId];

  if (!room) throw new Error('Room not found');

  if (room.status !== 'countdown') {
    throw new Error('Game is not in countdown');
  }

  const player = room.players.find(
    p => String(p.id) === String(playerId)
  );

  if (!player) {
    throw new Error('You are not in this room');
  }

// Get this player's cartelas
const playerCartelas = room.playerCartelas[playerId] || [];

// Release their cartelas
for (const cartela of playerCartelas) {
  room.reservedCartelas.delete(cartela.id);
}

// Calculate and refund their entry fee
const refundAmount = room.entryFee * playerCartelas.length;

if (player.paymentSource === 'bonus') {
  const playerRef = this.db.ref(`players/${playerId}`);
  const currentPlayer = (await playerRef.once('value')).val() || {};

  await playerRef.update({
    referralBonusBalance:
      Number(currentPlayer.referralBonusBalance || 0) + refundAmount
  });
} else {
  await this.updatePlayerBalance(playerId, refundAmount, {
    type: 'cancel',
    roomId,
    amount: refundAmount,
    paymentSource: 'main',
    date: new Date().toISOString(),
  });
}

// Remove player from the room
room.players = room.players.filter(
  p => String(p.id) !== String(playerId)
);

// Remove their cartelas from the room
delete room.playerCartelas[playerId];

// Remove their fee from the pot
room.pot -= refundAmount;

  this.addSimulatedPlayers(room.id).catch(err => {
    console.error('❌ Failed to restart simulated players:', err);
  });

  return room.toJSON();
}
async leaveGame(roomId, playerId) {
  const room = this.rooms[roomId];

  if (!room) throw new Error('Room not found');

  if (room.status !== 'playing') {
    throw new Error('Game is not in progress');
  }

  const player = room.players.find(
    p => String(p.id) === String(playerId)
  );

  if (!player) {
    throw new Error('You are not in this game');
  }

  const playerCartelas = room.playerCartelas[playerId] || [];

  // Release cartelas
  for (const cartela of playerCartelas) {
    room.reservedCartelas.delete(cartela.id);
  }

  // Remove player cartelas
  delete room.playerCartelas[playerId];

  // Remove player from room
  room.players = room.players.filter(
    p => String(p.id) !== String(playerId)
  );

  // NO REFUND — game has already started

  return room.toJSON();
}
async startGameFromClient(roomId, playerId) {
  const room = this.rooms[roomId];

  if (!room) {
    throw new Error('Room not found');
  }

  if (room.status !== 'countdown') {
    throw new Error('Game is not in countdown');
  }

  const player = room.players.find(
    p => String(p.id) === String(playerId)
  );

  if (!player) {
    throw new Error('You are not in this room');
  }

  // Make sure the full 30 seconds has actually passed
  if (Date.now() < room.countdownEnd) {
    throw new Error('Countdown has not finished');
  }

  // Prevent the original server timer from starting the game twice
  if (room._countdownTimer) {
    clearTimeout(room._countdownTimer);
    room._countdownTimer = null;
  }

  this._startGame(room);

  return room.toJSON();
}

_startGame(room) {
  room.status = 'playing';
  room.calledNumbers = [];
  room._gameStartTime = Date.now();

  const numbers = [];
  for (let n = 1; n <= 75; n++) numbers.push(n);

  numbers.sort(() => Math.random() - 0.5);

  let idx = 0;

  room._drawTimer = setInterval(() => {
    if (room.status !== 'playing') {
      clearInterval(room._drawTimer);
      return;
    }

    if (idx >= numbers.length) {
      clearInterval(room._drawTimer);
      return;
    }

    room.calledNumbers.push(numbers[idx++]);

    // Check simulated players for automatic Bingo
    this._checkSimulatedBingo(room);

  }, DRAW_INTERVAL_MS);
}

_checkSimulatedBingo(room) {
  if (room.status !== 'playing' || room.winner) return;

  for (const player of room.players) {

    // Only simulated players
    if (!String(player.id).startsWith('sim_')) continue;

    const cartelas = room.playerCartelas[player.id] || [];

    for (const cartela of cartelas) {

      const valid = checkBingo(
        cartela.grid,
        room.calledNumbers
      );

      if (valid) {
  // Wait 1/3 second before declaring simulated-player Bingo
setTimeout(() => {
  this.claimBingo(
    room.id,
    player.id,
    cartela.id
  ).catch(err => {
    console.error(
      `❌ Simulated Bingo error for ${player.name}:`,
      err.message
    );
  });
}, 333);

  return;
}
    }
  }
}

  // ── bingo claim ───────────────────────────────────────────────────────────

  async claimBingo(roomId, playerId, cartelaId) {
    const room = this.rooms[roomId];
    if (!room) throw new Error('Room not found');
    if (room.status !== 'playing') throw new Error('Game not in progress');
    if (room.burnedCartelas.has(cartelaId)) {
  throw new Error('Cartela is burned');
}
    if (room.winner) throw new Error('Winner already declared');

    const playerCartelas = room.playerCartelas[playerId];
    if (!playerCartelas) throw new Error('You are not in this room');

    const cartela = playerCartelas.find(c => c.id === cartelaId);
    if (!cartela) throw new Error('Cartela not yours');

    const valid = checkBingo(cartela.grid, room.calledNumbers);
    if (!valid) {
  room.burnedCartelas.add(cartelaId);
  throw new Error('Invalid BINGO');
}

    // Stop drawing
    clearInterval(room._drawTimer);

    const player = room.players.find(
  p => String(p.id) === String(playerId)
);

if (!player) {
  throw new Error('Player not found in room');
}

const playerName = player.username || player.name || `Player ${playerId}`;

const winAmt = Math.floor(room.pot * WINNER_SHARE);

room.winner = {
  playerId,
  playerName,
  cartelaId,
  cartelaNumber: cartela.number,
  cartelaGrid: cartela.grid,
  amount: winAmt,
};
    room.status = 'winner';


// ALWAYS schedule reset immediately
setTimeout(() => {
  console.log(`🔄 AUTO RESET: ${room.id}`);
  this._resetRoom(room);
}, 5000);

// Credit winner to the same balance used to enter the game
if (player.paymentSource === 'bonus') {
  // Bonus-funded game → winnings go back to bonus balance
  if (this.db) {
    const bonusRef = this.db.ref(
      `players/${playerId}/referralBonusBalance`
    );

    const snapshot = await bonusRef.once('value');
    const currentBonus = Number(snapshot.val() || 0);

    await bonusRef.set(currentBonus + winAmt);
  }
} else {
  // Main-funded game → winnings go back to main balance
  await this.updatePlayerBalance(playerId, winAmt, {
    type: 'win',
    roomId,
    amount: winAmt,
    cartelaId,
    paymentSource: 'main',
    date: new Date().toISOString()
  });
}

// Store in Firebase
if (this.db) {
  const winnerRef = this.db.ref('winners').push();

  await winnerRef.set({
    ...room.winner,
    roomId,
    pot: room.pot,
    date: new Date().toISOString()
  });
  const dailyKey = getEthiopiaDailyKey();

await this.db.ref(
  `dailyLeaderboard/${dailyKey}/${playerId}`
).transaction(current => ({
  ...(current || {}),
  name: playerName,
  wins: Number(current?.wins || 0) + 1
}));


}

    return room.toJSON();
  }

  _resetRoom(room) {
  clearInterval(room._drawTimer);
  clearTimeout(room._countdownTimer);
  clearTimeout(room._resetTimer);

  console.log(`🔄 BEFORE RESET: ${room.id} = ${room.status}`);

room.reset();

console.log(`✅ AFTER RESET: ${room.id} = ${room.status}`);

  this.addSimulatedPlayers(room.id).catch(err => {
    console.error('❌ Failed to restart simulated players:', err);
  });
}

  // ── tournament leaderboard ────────────────────────────────────────────────

// ── DAILY LEADERBOARD ─────────────────────────────────────────

async getDailyLeaderboard() {
  if (!this.db) return [];

const dailyKey = getEthiopiaDailyKey();

  const snap = await this.db.ref(
    `dailyLeaderboard/${dailyKey}`
  ).once('value');

  const data = snap.val() || {};

  return Object.entries(data)
    .map(([playerId, player]) => ({
      id: String(playerId),
      name: player.name || 'Player',
      wins: Number(player.wins || 0)
    }))
    .filter(player => player.wins > 0)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

// ── DAILY LEADERBOARD ──────────────────────────────────────────────

async getTournamentLeaderboard() {
  return await this.getDailyLeaderboard();
}

  // ── getters ─────────────────────────────────────────────────────────────

    getRoom(roomId) {
    return this.rooms[roomId] || null;
  }

  getAllRooms() {
    return Object.values(this.rooms).map(r => r.toJSON());
  }

    setSimulatorEnabled(roomId, enabled) {
  if (
    typeof this.simulatorsEnabled !== 'object' ||
    this.simulatorsEnabled === null ||
    Array.isArray(this.simulatorsEnabled)
  ) {
    this.simulatorsEnabled = {
      '5br': true,
      '10br': true,
      '20br': true
    };
  }

  if (!Object.prototype.hasOwnProperty.call(this.simulatorsEnabled, roomId)) {
    this.simulatorsEnabled[roomId] = true;
  }

  this.simulatorsEnabled[roomId] = Boolean(enabled);

  console.log(
    `🤖 Simulator ${roomId}: ${this.simulatorsEnabled[roomId] ? 'ON' : 'OFF'}`
  );
}

}

module.exports = { GamesManager, ROOMS_CONFIG };