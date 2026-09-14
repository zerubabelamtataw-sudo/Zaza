'use strict';

/**
 * server.js
 * Bingo Express API — integrates Firebase Admin SDK + GamesManager
 *
 * ENV vars expected:
 *   FIREBASE_SERVICE_ACCOUNT  – JSON string of serviceAccountKey.json
 *   PORT                      – (optional) default 3000
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { GamesManager, setRecordWeeklyWin } = require('./gameManager');
const { bot, processGatewaySMS } = require('./bot');
const { setGamesManager } = require('./adminBot');
// ── Firebase init (graceful if credentials missing) ───────────────────────────
let db = null;
try {
  const admin = require('firebase-admin');
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Try loading from file for local dev
    serviceAccount = require('./serviceAccountKey.json');
  }

  if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

db = admin.database();
console.log('✅ Firebase Realtime Database connected');
  console.log('✅ Firebase connected');
} catch (e) {
  console.warn('⚠️  Firebase not configured — running in-memory mode:', e.message);
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app    = express();
const gm     = new GamesManager(db);
setGamesManager(gm);
gm.addSimulatedPlayers('5br');
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================================
// PLAYER — SUBMIT DEPOSIT
// ============================================================

app.post('/api/deposit', async (req, res) => {
  try {
    const { telegramId, amount, sms, method } = req.body || {};

    if (!telegramId || !sms) {
      return res.status(400).json({
        success: false,
        error: 'Missing Telegram ID or payment SMS'
      });
    }

    const playerId = String(telegramId);
    const requestedAmount = Number(amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount < 50) {
      return res.status(400).json({
        success: false,
        error: 'Minimum deposit is 50 Br'
      });
    }

    const playerRef = db.ref(`players/${playerId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();

    if (!player) {
      return res.status(404).json({
        success: false,
        error: 'Player not found'
      });
    }

    const normalizeDigits = (value) =>
      String(value || '')
        .replace(/[٠-٩]/g, d =>
          String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        )
        .replace(/[۰-۹]/g, d =>
          String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
        );

    const normalizedSms = normalizeDigits(sms);

    const numberMatches =
      normalizedSms.match(
        /\d+(?:[\s,]\d{3})*(?:\.\d{1,2})?/g
      ) || [];

    let parsedAmount = null;

    for (const value of numberMatches) {
      const numericValue = Number(
        value.replace(/[\s,]/g, '')
      );

      if (
        Number.isFinite(numericValue) &&
        numericValue === requestedAmount
      ) {
        parsedAmount = requestedAmount;
        break;
      }
    }

    if (parsedAmount === null) {
      return res.status(400).json({
        success: false,
        error: 'The SMS amount does not match your deposit amount'
      });
    }

    const officialSnapshot =
      await db.ref('officialDeposits').once('value');

    const officialDeposits =
      officialSnapshot.val() || {};

    const compactSms =
      normalizedSms
        .replace(/[\s-]/g, '')
        .toUpperCase();

    let transactionId = null;
    let official = null;

    for (const [id, deposit] of Object.entries(officialDeposits)) {
      if (!deposit) continue;
      if (deposit.status !== 'available') continue;
      if (Number(deposit.amount) !== parsedAmount) continue;

      const compactId =
        String(id)
          .replace(/[\s-]/g, '')
          .toUpperCase();

      if (compactSms.includes(compactId)) {
        transactionId = String(id).toUpperCase();
        official = deposit;
        break;
      }
    }

    if (!transactionId || !official) {
      return res.status(400).json({
        success: false,
        error: 'Payment SMS could not be verified'
      });
    }

    if (
      official.expiresAt &&
      Date.now() > new Date(official.expiresAt).getTime()
    ) {
      return res.status(400).json({
        success: false,
        error: 'This payment SMS has expired'
      });
    }

    if (
      Number(official.amount) !== parsedAmount ||
      String(official.transactionId).toUpperCase() !==
        transactionId.toUpperCase()
    ) {
      return res.status(400).json({
        success: false,
        error: 'The SMS does not match the official payment record'
      });
    }

    const transactionRef =
      db.ref('transactions').push();

    await transactionRef.set({
      playerId: playerId,
      telegramId: playerId,
      type: 'deposit',
      amount: requestedAmount,
      status: 'approved',
      paymentMethod: method || 'unknown',
      sms: sms,
      transactionId: transactionId,
      officialDepositId: transactionId,
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString()
    });

    const balanceRef =
      db.ref(`players/${playerId}/balance`);

    const balanceResult =
      await balanceRef.transaction(
        balance => Number(balance || 0) + requestedAmount
      );

    const newBalance =
      Number(balanceResult.snapshot.val() || 0);

    await db
      .ref(`officialDeposits/${transactionId}`)
      .update({
        status: 'used',
        usedBy: playerId,
        usedTransaction: transactionRef.key,
        usedAt: new Date().toISOString()
      });

    return res.json({
      success: true,
      message: 'Deposit approved successfully',
      transactionId: transactionId,
      newBalance: newBalance
    });

  } catch (error) {
    console.error('❌ Player deposit error:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// ============================================================
// PLAYER — SUBMIT WITHDRAWAL
// ============================================================

app.post('/api/withdraw', async (req, res) => {
  try {
    const {
      telegramId,
      amount,
      method,
      account
    } = req.body || {};

    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Firebase is not connected'
      });
    }

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        message: 'Player ID required'
      });
    }

    const requestedAmount = Number(amount);

    if (!Number.isFinite(requestedAmount) || requestedAmount < 50) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal is 50 Br'
      });
    }

    if (!account) {
      return res.status(400).json({
        success: false,
        message: 'Account number required'
      });
    }

    const allowedMethods = ['cbeBirr', 'telebirr', 'cbe'];

    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal method'
      });
    }

    const playerId = String(telegramId);

    const playerRef = db.ref(`players/${playerId}`);
    const playerSnapshot = await playerRef.once('value');
    const player = playerSnapshot.val();

    if (!player) {
      return res.status(404).json({
        success: false,
        message: 'Player not found'
      });
    }

    // Player must have at least one approved deposit
    const transactionsSnapshot = await db
      .ref('transactions')
      .orderByChild('telegramId')
      .equalTo(playerId)
      .once('value');

    const transactions = transactionsSnapshot.val() || {};

    const hasApprovedDeposit = Object.values(transactions).some(transaction =>
      transaction &&
      transaction.type === 'deposit' &&
      transaction.status === 'approved'
    );

    if (!hasApprovedDeposit) {
      return res.status(400).json({
        success: false,
        message: 'You must make at least one approved deposit before withdrawing'
      });
    }

    const currentBalance = Number(player.balance || 0);

    // Must leave at least 50 Br
    if (currentBalance - requestedAmount < 50) {
      return res.status(400).json({
        success: false,
        message: 'You must leave at least 50 Br in your balance'
      });
    }

    const newBalance = currentBalance - requestedAmount;

    // Deduct balance
    await playerRef.child('balance').set(newBalance);

    // Create pending withdrawal transaction
    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      playerId: playerId,
      telegramId: playerId,
      type: 'withdrawal',
      amount: requestedAmount,
      withdrawSource: 'main',
      mainAmount: requestedAmount,
      status: 'pending',
      balanceDeducted: true,
      paymentMethod: method,
      withdrawalPhone: String(account).trim(),
      firstName: method === 'cbe'
        ? (player.first_name || '')
        : '',
      createdAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Withdrawal submitted successfully',
      transactionId: transactionRef.key,
      remainingBalance: newBalance
    });

  } catch (error) {
    console.error('❌ Player withdrawal error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).send('ZA Bingo server is alive');
});

// ============================================================
// ADMIN LOGIN
// ============================================================

app.post('/api/admin/login', (req, res) => {

  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({
      success: false,
      message: 'ADMIN_PASSWORD is not configured'
    });
  }

  if (!password || password !== adminPassword) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin password'
    });
  }

  res.json({
    success: true,
    message: 'Admin login successful'
  });

});

// ============================================================
// ADMIN — ADD BALANCE
// ============================================================

app.post('/api/admin/add-balance', async (req, res) => {

  try {

    const { password, playerId, amount } = req.body || {};

    const adminPassword = process.env.ADMIN_PASSWORD;

    // Check admin password
    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Validate player ID
    if (!playerId) {
      return res.status(400).json({
        success: false,
        message: 'Player ID required'
      });
    }

    // Validate amount
    const addAmount = Number(amount);

    if (!Number.isFinite(addAmount) || addAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Firebase is not connected'
      });
    }

    const playerRef = db.ref(`players/${playerId}`);

    const snapshot = await playerRef.once('value');
    const player = snapshot.val();

    if (!player) {
      return res.status(404).json({
        success: false,
        message: 'Player not found'
      });
    }

    const currentBalance = Number(player.balance || 0);
    const newBalance = currentBalance + addAmount;

    await playerRef.update({
      balance: newBalance
    });

    // Save admin transaction
    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: 'admin_add_balance',
      playerId: String(playerId),
      amount: addAmount,
      previousBalance: currentBalance,
      newBalance: newBalance,
      status: 'completed',
      createdAt: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Balance added successfully',
      previousBalance: currentBalance,
      newBalance: newBalance
    });

  } catch (error) {

    console.error('❌ Admin add balance error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error'
    });

  }

});

// 


// ============================================================
// ADMIN — APPROVE TRANSACTION
// ============================================================

app.post('/api/admin/approve-transaction', async (req, res) => {

  try {

    const {
      password,
      transactionId
    } = req.body || {};

    const adminPassword = process.env.ADMIN_PASSWORD;

    // Check admin password
    if (!adminPassword || password !== adminPassword) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID required'
      });
    }

    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Firebase is not connected'
      });
    }

    const transactionRef =
      db.ref(`transactions/${transactionId}`);

    const snapshot =
      await transactionRef.once('value');

    const transaction =
      snapshot.val();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Already approved
    if (
      String(transaction.status).toLowerCase() ===
      'approved'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Transaction already approved'
      });
    }

    // Only pending transactions
    if (
      String(transaction.status).toLowerCase() !==
      'pending'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Only pending transactions can be approved'
      });
    }

    // ========================================================
    // APPROVE TRANSACTION
    // ========================================================

    await transactionRef.update({

      status: 'approved',

      approvedAt:
        new Date().toISOString()

    });

    // ========================================================
    // SEND TELEGRAM NOTIFICATION
    // ========================================================

    if (transaction.telegramId) {

      try {

        const playerRef =
          db.ref(`players/${transaction.telegramId}`);

        const playerSnapshot =
          await playerRef.once('value');

        const player =
          playerSnapshot.val();

        const remainingBalance =
          Number(player?.balance || 0);

        await bot.sendMessage(
          String(transaction.telegramId),

          `✅ *Withdrawal approved!*\n\n` +
          `💰 Amount: ${Number(transaction.amount)} Br\n` +
          `📱 Phone: ${transaction.withdrawalPhone || 'N/A'}\n\n` +
          `💰 Remaining balance: ${remainingBalance} Br`,

          {
            parse_mode: 'Markdown'
          }
        );

        console.log(
          `📨 Withdrawal approval notification sent to ${transaction.telegramId}`
        );

      } catch (telegramError) {

        console.error(
          '⚠️ Transaction approved, but Telegram notification failed:',
          telegramError
        );

      }

    } else {

      console.log(
        '⚠️ Transaction has no telegramId — notification not sent'
      );

    }

    // ========================================================
    // RESPONSE
    // ========================================================

    return res.json({
      success: true,
      message: 'Transaction approved successfully'
    });

  } catch (error) {

    console.error(
      '❌ Approve transaction error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Server error'
    });

  }

});

// ── Helper ────────────────────────────────────────────────────────────────────
const ok  = (res, data)  => res.json({ success: true,  ...data });
const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

app.get('/api/admin/sim-settings', (req, res) => {
  ok(res, {
    settings: gm.simPlayerSettings
  });
});

app.post('/api/admin/sim-settings', (req, res) => {
  const { settings } = req.body || {};

  if (!settings) {
    return err(res, 'Settings required');
  }

  gm.simPlayerSettings = {
    '5br': Math.max(0, Number(settings['5br'] || 0)),
    '10br': Math.max(0, Number(settings['10br'] || 0)),
    '20br': Math.max(0, Number(settings['20br'] || 0))
  };

  ok(res, {
    settings: gm.simPlayerSettings
  });
});
// ============================================================
// ADMIN — MASTER SIMULATED PLAYERS ON/OFF
// ============================================================

// Default: SIMULATORS ON
if (typeof gm.simulatorsEnabled !== 'boolean') {
  gm.simulatorsEnabled = true;
}

// GET current simulator master status
app.get('/api/admin/simulators-status', (req, res) => {
  ok(res, {
    enabled: gm.simulatorsEnabled
  });
});

// Toggle simulator master switch
app.post('/api/admin/simulators-toggle', (req, res) => {

  gm.simulatorsEnabled =
    !gm.simulatorsEnabled;

  console.log(
    gm.simulatorsEnabled
      ? '🤖 SIMULATORS ENABLED'
      : '🛑 SIMULATORS DISABLED'
  );

  ok(res, {
    enabled: gm.simulatorsEnabled
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/cartelas — return all 300 cartelas
app.get('/api/cartelas', async (req, res) => {
  try {
    const cartelas = await gm.getCartelas();
    ok(res, { cartelas });
  } catch (e) { err(res, e.message); }
});

// GET /api/rooms — list all 3 rooms
app.get('/api/rooms', (req, res) => {
  ok(res, { rooms: gm.getAllRooms() });
});

// GET /api/tournament/leaderboard
app.get('/api/tournament/leaderboard', async (req, res) => {
  try {

    const type = req.query.type === 'weekly'
      ? 'weekly'
      : 'daily';

    const leaderboard =
      await gm.getTournamentLeaderboard(type);

    ok(res, {
      leaderboard,
      type
    });

  } catch (e) {

    res.status(500).json({
      success: false,
      error: e.message
    });

  }
});

// GET /api/rooms/:roomId — single room state
app.get('/api/rooms/:roomId', (req, res) => {
  const room = gm.getRoom(req.params.roomId);
  if (!room) return err(res, 'Room not found', 404);
  ok(res, { room: room.toJSON() });
});

// POST /api/player — get or create player
// body: { playerId, name }
app.post('/api/player', async (req, res) => {
  const { playerId, name, username } = req.body || {};

  if (!playerId) {
    return err(res, 'Telegram player ID required');
  }

  try {
    const player = await gm.getOrCreatePlayer(
  String(playerId),
  name || 'Player',
  username || ''
);

    ok(res, { player });
  } catch (e) {
    err(res, e.message);
  }
});

// GET /api/player/:playerId
app.get('/api/player/:playerId', async (req, res) => {
  try {
    const player = await gm.getOrCreatePlayer(req.params.playerId, 'Player');
    ok(res, { player });
  } catch (e) { err(res, e.message); }
});

// POST /api/rooms/:roomId/join
// body: { playerId, cartelaIds: string[] }
app.post('/api/rooms/:roomId/join', async (req, res) => {
  const { playerId, cartelaIds } = req.body || {};
  if (!playerId || !Array.isArray(cartelaIds)) {
    return err(res, 'playerId and cartelaIds[] required');
  }
  try {
    const player = await gm.getOrCreatePlayer(playerId, 'Player');
    const room   = await gm.joinRoom(req.params.roomId, player, cartelaIds);
    ok(res, { room });
  } catch (e) { err(res, e.message); }
});

// POST /api/rooms/:roomId/cancel-countdown
// body: { playerId }
app.post('/api/rooms/:roomId/cancel-countdown', async (req, res) => {
  const { playerId } = req.body || {};

  if (!playerId) {
    return err(res, 'playerId required');
  }

  try {
    const room = await gm.cancelCountdown(
      req.params.roomId,
      playerId
    );

    ok(res, { room });
  } catch (e) {
    err(res, e.message);
  }
});
// POST /api/rooms/:roomId/leave-game
// body: { playerId }
app.post('/api/rooms/:roomId/leave-game', async (req, res) => {
  const { playerId } = req.body || {};

  if (!playerId) {
    return err(res, 'playerId required');
  }

  try {
    const room = await gm.leaveGame(
      req.params.roomId,
      playerId
    );

    ok(res, { room });
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/rooms/:roomId/start-game
app.post('/api/rooms/:roomId/start-game', async (req, res) => {
  const { playerId } = req.body || {};

  if (!playerId) {
    return err(res, 'playerId required');
  }

  try {
    const game = await gm.startGameFromClient(
      req.params.roomId,
      playerId
    );

    ok(res, { game });
  } catch (e) {
    err(res, e.message);
  }
});

// GET /api/game/:roomId — alias for room state (frontend polling)
app.get('/api/game/:roomId', (req, res) => {
  const room = gm.getRoom(req.params.roomId);
  if (!room) return err(res, 'Room not found', 404);
  ok(res, { game: room.toJSON() });
});

// POST /api/rooms/:roomId/bingo
// body: { playerId, cartelaId }
app.post('/api/rooms/:roomId/bingo', async (req, res) => {
  const { playerId, cartelaId } = req.body || {};
  if (!playerId || !cartelaId) return err(res, 'playerId and cartelaId required');
  try {
    const result = await gm.claimBingo(req.params.roomId, playerId, cartelaId);
    ok(res, { game: result, winner: result.winner });
  } catch (e) { err(res, e.message); }
});
// ============================================================
// SMS GATEWAY TEST
// ============================================================

app.post('/api/sms', async (req, res) => {
  try {

    console.log('📩 SMS RECEIVED FROM SMS GATE:');
    console.log(JSON.stringify(req.body, null, 2));

    const sender =
      req.body.sender ||
      req.body.payload?.sender ||
      '';

    const message =
      req.body.message ||
      req.body.payload?.message ||
      '';

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'No SMS message'
      });
    }

    const forwardedText =
      `From: ${sender}\n` +
      `Time: ${new Date().toISOString()}\n` +
      message;

    await processGatewaySMS(forwardedText);

    res.json({
      success: true
    });

  } catch (error) {

    console.error(
      '❌ Gateway SMS error:',
      error
    );

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Maintenance / frontend
app.get('*', async (req, res) => {
  try {
    const snapshot = await db.ref('maintenance/enabled').once('value');
    const maintenanceOn = snapshot.val() === true;

    if (maintenanceOn) {
      return res.sendFile(
        path.resolve(__dirname, '..', 'maintenance.html')
      );
    }

    return res.sendFile(
      path.resolve(__dirname, '..', 'index.html')
    );

  } catch (error) {
    console.error('❌ Maintenance check error:', error);

    return res.sendFile(
      path.resolve(__dirname, '..', 'index.html')
    );
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎱 Bingo server running on http://localhost:${PORT}`);
});

module.exports = app;