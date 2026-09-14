'use strict';

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const token = process.env.ADMIN_BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');

if (!token) {
  throw new Error('ADMIN_BOT_TOKEN is missing');
}

const db = admin.database();

const adminBot = new TelegramBot(token, {
  polling: true
});

let gamesManager = null;

function setGamesManager(manager) {
  gamesManager = manager;
  console.log('✅ GamesManager connected to Admin Bot');
}

function isAdmin(msg) {
  return String(msg.from?.id) === ADMIN_ID;
}
async function toggleMaintenance(chatId) {
  const ref = db.ref('maintenance/enabled');

  const snapshot = await ref.once('value');
  const current = snapshot.val() === true;
  const next = !current;

  await ref.set(next);

  await adminBot.sendMessage(
    chatId,
    next
      ? '🔧 Maintenance mode is now ON.'
      : '🔧 Maintenance mode is now OFF.'
  );
}

// ============================================================
// STATE
// ============================================================

const waitingForPhone = new Set();
const waitingForAmount = new Map();
const selectedPlayers = new Map();

// ============================================================
// ADMIN PANEL
// ============================================================

function showAdminPanel(chatId) {
  return adminBot.sendMessage(chatId, '🏠 ADMIN PANEL', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '👤 Players', callback_data: 'admin_players' },
          { text: '💰 Balances', callback_data: 'admin_balances' }
        ],
        [
          { text: '⚠️ Below 50 Br', callback_data: 'admin_below50' },
          { text: '📊 Data Analysis', callback_data: 'admin_analysis' }
        ],
        [
  { text: '📩 Official SMS', callback_data: 'admin_sms' },
  { text: '🏆 Top 15 Richest', callback_data: 'admin_top15' }
],
        [
  { text: '🤖 Sim Players', callback_data: 'admin_sim_players' }
],
[
  { text: '💵 Balance Ranges', callback_data: 'admin_balance_ranges' }
],
        [
          { text: '🔧 Maintenance OFF', callback_data: 'admin_maintenance' }
        ],
        [
          { text: '✅ Approved', callback_data: 'admin_approved' }
        ]
      ]
    }
  });
}

// ============================================================
// PLAYERS MENU
// ============================================================

function showSimPlayersMenu(chatId) {
  if (!gamesManager) {
    return adminBot.sendMessage(
      chatId,
      '❌ Game manager is not connected.'
    );
  }

  const status = gamesManager.simulatorsEnabled;

  return adminBot.sendMessage(chatId, '🤖 SIM PLAYERS', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `5 Br Room ${status['5br'] ? '🟢 ON' : '🔴 OFF'}`,
            callback_data: 'sim_toggle_5br'
          }
        ],
        [
          {
            text: `10 Br Room ${status['10br'] ? '🟢 ON' : '🔴 OFF'}`,
            callback_data: 'sim_toggle_10br'
          }
        ],
        [
          {
            text: `20 Br Room ${status['20br'] ? '🟢 ON' : '🔴 OFF'}`,
            callback_data: 'sim_toggle_20br'
          }
        ]
      ]
    }
  });
}

function showPlayersMenu(chatId) {
  return adminBot.sendMessage(chatId, '👤 PLAYERS', {
    reply_markup: {
      keyboard: [
        ['🔎 Find Player'],
        ['🏠 ADMIN PANEL']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// PLAYER ACTION MENU
// ============================================================

function showPlayerActions(chatId) {
  return adminBot.sendMessage(chatId, '👤 MANAGE PLAYER', {
    reply_markup: {
      keyboard: [
        ['➕ Add Main', '➖ Remove Main'],
        ['🎁 Add Bonus', '➖ Remove Bonus'],
        ['📋 Transactions'],
        ['👤 Players', '🏠 ADMIN PANEL']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// PHONE NORMALIZATION
// ============================================================

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');

  if (digits.startsWith('251')) {
    digits = digits.slice(3);
  }

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits;
}

// ============================================================
// FIND PLAYER
// ============================================================

async function askForPlayerPhone(chatId) {
  waitingForPhone.add(String(chatId));

  await adminBot.sendMessage(
    chatId,
    '🔎 FIND PLAYER\n\nSend the player phone number.',
    {
      reply_markup: {
        keyboard: [
          ['❌ Cancel']
        ],
        resize_keyboard: true
      }
    }
  );
}

async function findPlayerByPhone(chatId, phone) {
  try {
    const searchPhone = normalizePhone(phone);

    if (!searchPhone) {
      await adminBot.sendMessage(
        chatId,
        '❌ Invalid phone number.'
      );
      return;
    }

    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let foundPlayer = null;
    let foundId = null;

    for (const [playerId, player] of Object.entries(players)) {
      if (!player || typeof player !== 'object') continue;

      const playerPhone = normalizePhone(
        player.phone ||
        player.phoneNumber ||
        player.mobile ||
        ''
      );

      if (playerPhone === searchPhone) {
        foundPlayer = player;
        foundId = playerId;
        break;
      }
    }

    if (!foundPlayer) {
      await adminBot.sendMessage(
        chatId,
        `❌ No player found for:\n${phone}`
      );
      return;
    }

    selectedPlayers.set(String(chatId), foundId);

    await sendPlayerProfile(chatId, foundId, foundPlayer);

  } catch (error) {
    console.error('❌ Find player error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to search for player.'
    );
  }
}

// ============================================================
// PLAYER PROFILE
// ============================================================

async function sendPlayerProfile(chatId, playerId, player) {
  const mainBalance = Number(player.balance || 0);
  const bonusBalance = Number(
    player.referralBonusBalance || 0
  );

  const totalBalance = mainBalance + bonusBalance;

  const status =
    player.status ||
    (player.blocked ? 'blocked' : 'active');

  await adminBot.sendMessage(
    chatId,
    `👤 *PLAYER FOUND*\n\n` +
    `📱 Phone: ${player.phone || player.phoneNumber || 'N/A'}\n` +
    `🆔 Telegram ID: ${playerId}\n` +
    `💰 Main Balance: ${mainBalance.toFixed(2)} Br\n` +
    `🎁 Bonus Balance: ${bonusBalance.toFixed(2)} Br\n` +
    `💵 Combined: ${totalBalance.toFixed(2)} Br\n` +
    `📌 Status: ${status}`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ['➕ Add Main', '➖ Remove Main'],
          ['🎁 Add Bonus', '➖ Remove Bonus'],
          ['📋 Transactions'],
          ['👤 Players', '🏠 ADMIN PANEL']
        ],
        resize_keyboard: true
      }
    }
  );
}

// ============================================================
// BALANCE ACTION
// ============================================================

function startBalanceAction(chatId, action) {
  const playerId = selectedPlayers.get(String(chatId));

  if (!playerId) {
    return adminBot.sendMessage(
      chatId,
      '❌ Find a player first.'
    );
  }

  waitingForAmount.set(String(chatId), action);

  let message = '';

  if (action === 'addMain') {
    message = '➕ ADD MAIN\n\nSend the amount in Br.';
  }

  if (action === 'removeMain') {
    message = '➖ REMOVE MAIN\n\nSend the amount in Br.';
  }

  if (action === 'addBonus') {
    message = '🎁 ADD BONUS\n\nSend the amount in Br.';
  }

  if (action === 'removeBonus') {
    message = '➖ REMOVE BONUS\n\nSend the amount in Br.';
  }

  return adminBot.sendMessage(chatId, message, {
    reply_markup: {
      keyboard: [
        ['❌ Cancel']
      ],
      resize_keyboard: true
    }
  });
}

// ============================================================
// APPLY BALANCE CHANGE
// ============================================================

async function applyBalanceChange(chatId, amountText) {
  const chatKey = String(chatId);
  const action = waitingForAmount.get(chatKey);
  const playerId = selectedPlayers.get(chatKey);

  if (!action || !playerId) {
    return;
  }

  const amount = Number(
    String(amountText).replace(/,/g, '')
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    await adminBot.sendMessage(
      chatId,
      '❌ Enter a valid positive amount.'
    );
    return;
  }

  try {
    const playerRef = db.ref(`players/${playerId}`);
    const snapshot = await playerRef.once('value');
    const player = snapshot.val();

    if (!player) {
      waitingForAmount.delete(chatKey);

      await adminBot.sendMessage(
        chatId,
        '❌ Player no longer exists.'
      );
      return;
    }

    const oldMain = Number(player.balance || 0);
    const oldBonus = Number(
      player.referralBonusBalance || 0
    );

    let newMain = oldMain;
    let newBonus = oldBonus;
    let balanceType = '';

    if (action === 'addMain') {
      newMain += amount;
      balanceType = 'main';
    }

    if (action === 'removeMain') {
      if (oldMain < amount) {
        await adminBot.sendMessage(
          chatId,
          `❌ Insufficient main balance.\n\nCurrent: ${oldMain.toFixed(2)} Br`
        );
        return;
      }

      newMain -= amount;
      balanceType = 'main';
    }

    if (action === 'addBonus') {
      newBonus += amount;
      balanceType = 'bonus';
    }

    if (action === 'removeBonus') {
      if (oldBonus < amount) {
        await adminBot.sendMessage(
          chatId,
          `❌ Insufficient bonus balance.\n\nCurrent: ${oldBonus.toFixed(2)} Br`
        );
        return;
      }

      newBonus -= amount;
      balanceType = 'bonus';
    }

    await playerRef.update({
      balance: newMain,
      referralBonusBalance: newBonus
    });

    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: action,
      source: 'admin_bot',
      playerId: playerId,
      amount: amount,
      balanceType: balanceType,
      previousMainBalance: oldMain,
      newMainBalance: newMain,
      previousBonusBalance: oldBonus,
      newBonusBalance: newBonus,
      status: 'completed',
      adminId: ADMIN_ID,
      createdAt: Date.now()
    });

    waitingForAmount.delete(chatKey);

    await adminBot.sendMessage(
      chatId,
      `✅ BALANCE UPDATED\n\n` +
      `🆔 Player: ${playerId}\n` +
      `💰 Main: ${newMain.toFixed(2)} Br\n` +
      `🎁 Bonus: ${newBonus.toFixed(2)} Br\n` +
      `💵 Combined: ${(newMain + newBonus).toFixed(2)} Br`
    );

    const updatedSnapshot = await playerRef.once('value');
    const updatedPlayer = updatedSnapshot.val();

    await sendPlayerProfile(
      chatId,
      playerId,
      updatedPlayer
    );

  } catch (error) {
    console.error('❌ Balance change error:', error);

    waitingForAmount.delete(chatKey);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to update balance.'
    );
  }
}

// ============================================================
// BALANCE TOTALS
// ============================================================

async function showBalanceTotals(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let realMain = 0;
    let realBonus = 0;
    let simMain = 0;
    let simBonus = 0;

    for (const player of Object.values(players)) {
      if (!player || typeof player !== 'object') continue;

      const main = Number(player.balance || 0);
      const bonus = Number(
        player.referralBonusBalance || 0
      );

      const isSim = player.isSimulated === true;

      if (isSim) {
        simMain += main;
        simBonus += bonus;
      } else {
        realMain += main;
        realBonus += bonus;
      }
    }

    const realTotal = realMain + realBonus;
    const simTotal = simMain + simBonus;

    const allMain = realMain + simMain;
    const allBonus = realBonus + simBonus;
    const allTotal = allMain + allBonus;

    await adminBot.sendMessage(
      chatId,
      `💰 *BALANCE TOTALS*\n\n` +

      `👤 *REAL PLAYERS*\n` +
      `Main: ${realMain.toFixed(2)} Br\n` +
      `Bonus: ${realBonus.toFixed(2)} Br\n` +
      `Total: ${realTotal.toFixed(2)} Br\n\n` +

      `🤖 *SIM PLAYERS*\n` +
      `Main: ${simMain.toFixed(2)} Br\n` +
      `Bonus: ${simBonus.toFixed(2)} Br\n` +
      `Total: ${simTotal.toFixed(2)} Br\n\n` +

      `🔥 *ALL PLAYERS*\n` +
      `Main: ${allMain.toFixed(2)} Br\n` +
      `Bonus: ${allBonus.toFixed(2)} Br\n` +
      `TOTAL: ${allTotal.toFixed(2)} Br`,
      {
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('❌ Admin balance totals error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load balance totals.'
    );
  }
}
// ============================================================
// PLAYER TRANSACTIONS
// ============================================================

async function showPlayerTransactions(chatId) {
  const playerId = selectedPlayers.get(String(chatId));

  if (!playerId) {
    await adminBot.sendMessage(
      chatId,
      '❌ Find a player first.'
    );
    return;
  }

  try {
    const snapshot = await db.ref('transactions').once('value');
    const transactions = snapshot.val() || {};

    const playerTransactions = Object.entries(transactions)
      .filter(([_, tx]) =>
        tx &&
        String(tx.playerId || '') === String(playerId)
      )
      .sort((a, b) =>
        Number(b[1].createdAt || 0) -
        Number(a[1].createdAt || 0)
      )
      .slice(0, 20);

    if (playerTransactions.length === 0) {
      await adminBot.sendMessage(
        chatId,
        `📋 TRANSACTIONS\n\nNo transactions found for:\n${playerId}`
      );
      return;
    }

    let message = `📋 *TRANSACTIONS*\n\n🆔 ${playerId}\n\n`;

    for (const [txId, tx] of playerTransactions) {
      const amount = Number(tx.amount || 0);
      const type = tx.type || 'unknown';
      const status = tx.status || 'unknown';

      message +=
        `• ${type}\n` +
        `  Amount: ${amount.toFixed(2)} Br\n` +
        `  Status: ${status}\n` +
        `  ID: ${txId}\n\n`;
    }

    await adminBot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('❌ Transactions error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load transactions.'
    );
  }
}
// ============================================================
// OFFICIAL SMS - PENDING
// ============================================================

async function showPendingOfficialSMS(chatId) {
  try {
    const snapshot = await db.ref('officialDeposits').once('value');
    const deposits = snapshot.val() || {};

    const pending = Object.entries(deposits)
      .filter(([_, deposit]) =>
        deposit &&
        deposit.status === 'available'
      )
      .sort((a, b) =>
        new Date(b[1].receivedAt || 0) -
        new Date(a[1].receivedAt || 0)
      );

    if (pending.length === 0) {
      await adminBot.sendMessage(
        chatId,
        '📩 OFFICIAL SMS\n\nNo pending deposits.'
      );
      return;
    }

    let message = `📩 *PENDING OFFICIAL SMS*\n\n`;

    pending.slice(0, 20).forEach(([transactionId, deposit], index) => {
      message +=
        `${index + 1}. 💰 ${Number(deposit.amount || 0).toFixed(2)} Br\n` +
        `🆔 ${transactionId}\n` +
        `🕒 ${deposit.receivedAt || 'N/A'}\n\n`;
    });

    await adminBot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('❌ Pending official SMS error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load official SMS.'
    );
  }
}
// ============================================================
// PLAYER BALANCE RANGES
// ============================================================

async function showBalanceRanges(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let from50To1000 = 0;
    let above1000 = 0;

    for (const player of Object.values(players)) {
      if (!player || typeof player !== 'object') continue;

      // Ignore simulator players
      if (player.isSimulated === true) continue;

      const balance =
        Number(player.balance || 0) +
        Number(player.referralBonusBalance || 0);

      if (balance >= 50 && balance <= 1000) {
        from50To1000++;
      }

      if (balance > 1000) {
        above1000++;
      }
    }

    const total = from50To1000 + above1000;

    await adminBot.sendMessage(
      chatId,
      `💵 PLAYER BALANCE RANGES\n\n` +
      `50 – 1,000 Br: ${from50To1000} players\n` +
      `Above 1,000 Br: ${above1000} players\n\n` +
      `Total: ${total} players`
    );

  } catch (error) {
    console.error('❌ Balance ranges error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load player balance ranges.'
    );
  }
}
// ============================================================
// TOP 15 RICHEST REAL PLAYERS

async function showTop15Players(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    const topPlayers = Object.values(players)
      .filter(player =>
        player &&
        typeof player === 'object' &&
        player.isSimulated !== true
      )
      .map(player => {
        const main = Number(player.balance || 0);
        const bonus = Number(player.referralBonusBalance || 0);

        return {
          name: player.first_name || player.username || 'Player',
          main,
          bonus,
          combined: main + bonus
        };
      })
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 15);

    if (topPlayers.length === 0) {
      await adminBot.sendMessage(
        chatId,
        '🏆 TOP 15 RICHEST PLAYERS\n\nNo real players found.'
      );
      return;
    }

    let message = '🏆 TOP 15 RICHEST REAL PLAYERS\n\n';

    topPlayers.forEach((player, index) => {
      message +=
        `${index + 1}. ${player.name}   ` +
        `Main: ${player.main.toFixed(2)} Br   ` +
        `Bonus: ${player.bonus.toFixed(2)} Br\n`;
    });

    await adminBot.sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ Top 15 players error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load Top 15 players.'
    );
  }
}
// ============================================================
// TOP 15 RICHEST REAL PLAYERS
// ============================================================

async function showTop15Players(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    const topPlayers = Object.values(players)
      .filter(player =>
        player &&
        typeof player === 'object' &&
        player.isSimulated !== true
      )
      .map(player => {
        const main = Number(player.balance || 0);
        const bonus = Number(player.referralBonusBalance || 0);

        return {
          name: player.first_name || player.username || 'Player',
          main,
          bonus,
          combined: main + bonus
        };
      })
      .sort((a, b) => b.combined - a.combined)
      .slice(0, 15);

    if (topPlayers.length === 0) {
      await adminBot.sendMessage(
        chatId,
        '🏆 TOP 15 RICHEST PLAYERS\n\nNo real players found.'
      );
      return;
    }

    let message = '🏆 TOP 15 RICHEST REAL PLAYERS\n\n';

    topPlayers.forEach((player, index) => {
      message +=
        `${index + 1}. ${player.name}   ` +
        `Main: ${player.main.toFixed(2)} Br   ` +
        `Bonus: ${player.bonus.toFixed(2)} Br\n`;
    });

    await adminBot.sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ Top 15 players error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load Top 15 players.'
    );
  }
}

// ============================================================
// VIEW DEPOSIT
// ============================================================

async function viewOfficialDeposit(chatId, transactionId) {
  try {
    const snapshot = await db.ref(`officialDeposits/${transactionId}`).once('value');
    const deposit = snapshot.val();

    if (!deposit) {
      await adminBot.sendMessage(chatId, '❌ Deposit not found.');
      return;
    }

    await adminBot.sendMessage(
      chatId,
      `📩 *DEPOSIT DETAILS*\n\n` +
      `💰 Amount: ${Number(deposit.amount || 0).toFixed(2)} Br\n` +
      `🆔 Transaction ID: ${transactionId}\n` +
      `📌 Status: ${deposit.status || 'N/A'}\n` +
      `🕒 Received: ${deposit.receivedAt || 'N/A'}\n\n` +
      `📨 *SMS:*\n${deposit.sms || 'N/A'}`,
      {
        parse_mode: 'Markdown'
      }
    );

  } catch (error) {
    console.error('❌ View deposit error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load deposit.'
    );
  }
}

// // ============================================================
// PLAYERS BELOW 50 BR - SUMMARY
// ============================================================

async function showPlayersBelow50(chatId) {
  try {
    const snapshot = await db.ref('players').once('value');
    const players = snapshot.val() || {};

    let count = 0;
    let combinedTotal = 0;

    for (const player of Object.values(players)) {
      if (!player || typeof player !== 'object') continue;
      if (player.isSimulated === true) continue;

      const main = Number(player.balance || 0);
      const bonus = Number(player.referralBonusBalance || 0);
      const combined = main + bonus;

      if (combined < 50) {
        count++;
        combinedTotal += combined;
      }
    }

    await adminBot.sendMessage(
      chatId,
      `⚠️ BELOW 50 Br\n\n` +
      `👤 Players: ${count}\n` +
      `💵 Combined Balance: ${combinedTotal.toFixed(2)} Br`
    );

  } catch (error) {
    console.error('❌ Below 50 error:', error);

    await adminBot.sendMessage(
      chatId,
      '❌ Failed to calculate players below 50 Br.'
    );
  }
}
async function showDataAnalysis(chatId) {
  try {
    const snapshot = await db.ref('winners').once('value');
    const winners = snapshot.val() || {};

    let games = 0;
    let totalCollected = 0;
    let totalPrizes = 0;
    let houseEarnings = 0;

    const rooms = {
      '5br': { games: 0, collected: 0, prizes: 0, house: 0 },
      '10br': { games: 0, collected: 0, prizes: 0, house: 0 },
      '20br': { games: 0, collected: 0, prizes: 0, house: 0 }
    };

    for (const game of Object.values(winners)) {
      if (!game || !game.roomId) continue;

      const pot = Number(game.pot || 0);
      const prize = Number(game.amount || 0);
      const house = pot - prize;

      games++;
      totalCollected += pot;
      totalPrizes += prize;
      houseEarnings += house;

      if (rooms[game.roomId]) {
        rooms[game.roomId].games++;
        rooms[game.roomId].collected += pot;
        rooms[game.roomId].prizes += prize;
        rooms[game.roomId].house += house;
      }
    }

    const money = amount =>
      `${Number(amount).toFixed(2)} Br`;

    const message =
      `📊 DATA ANALYSIS\n\n` +

      `🎮 Games Completed: ${games}\n` +
      `💰 Total Collected: ${money(totalCollected)}\n` +
      `🏆 Total Prizes: ${money(totalPrizes)}\n` +
      `🏠 House Earnings: ${money(houseEarnings)}\n\n` +

      `5️⃣ 5 Br Room\n` +
      `Games: ${rooms['5br'].games}\n` +
      `Collected: ${money(rooms['5br'].collected)}\n` +
      `Prize: ${money(rooms['5br'].prizes)}\n` +
      `House: ${money(rooms['5br'].house)}\n\n` +

      `🔟 10 Br Room\n` +
      `Games: ${rooms['10br'].games}\n` +
      `Collected: ${money(rooms['10br'].collected)}\n` +
      `Prize: ${money(rooms['10br'].prizes)}\n` +
      `House: ${money(rooms['10br'].house)}\n\n` +

      `2️⃣0️⃣ 20 Br Room\n` +
      `Games: ${rooms['20br'].games}\n` +
      `Collected: ${money(rooms['20br'].collected)}\n` +
      `Prize: ${money(rooms['20br'].prizes)}\n` +
      `House: ${money(rooms['20br'].house)}`;

    await adminBot.sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ Data analysis error:', error);
    await adminBot.sendMessage(
      chatId,
      '❌ Failed to load data analysis.'
    );
  }
}

// ============================================================
// INLINE ADMIN PANEL BUTTONS
// ============================================================

adminBot.on('callback_query', async (query) => {
  if (!isAdmin({ from: query.from })) return;

  const chatId = query.message.chat.id;

  try {
    await adminBot.answerCallbackQuery(query.id);

    switch (query.data) {

      case 'admin_sim_players':
        await showSimPlayersMenu(chatId);
        break;

      case 'sim_toggle_5br':
        gamesManager.setSimulatorEnabled(
          '5br',
          !gamesManager.simulatorsEnabled['5br']
        );
        await showSimPlayersMenu(chatId);
        break;

      case 'sim_toggle_10br':
        gamesManager.setSimulatorEnabled(
          '10br',
          !gamesManager.simulatorsEnabled['10br']
        );
        await showSimPlayersMenu(chatId);
        break;

      case 'sim_toggle_20br':
        gamesManager.setSimulatorEnabled(
          '20br',
          !gamesManager.simulatorsEnabled['20br']
        );
        await showSimPlayersMenu(chatId);
        break;

      case 'admin_players':
        await showPlayersMenu(chatId);
        break;

      case 'admin_balances':
        await showBalanceTotals(chatId);
        break;

      case 'admin_below50':
        await showPlayersBelow50(chatId);
        break;

      case 'admin_analysis':
        await showDataAnalysis(chatId);
        break;

      case 'admin_sms':
        await showPendingOfficialSMS(chatId);
        break;

      case 'admin_balance_ranges':
        await showBalanceRanges(chatId);
        break;

      case 'admin_top15':
        await showTop15Players(chatId);
        break;

      case 'admin_maintenance':
        await toggleMaintenance(chatId);
        break;
    }

  } catch (error) {
    console.error('❌ Admin inline button error:', error);
  }
});


adminBot.on('callback_query', async (query) => {
  if (!isAdmin({ from: query.from })) return;

  const chatId = query.message.chat.id;

  // Simulator callbacks are handled by the first handler above.
  if (
    query.data === 'admin_sim_players' ||
    query.data === 'sim_toggle_5br' ||
    query.data === 'sim_toggle_10br' ||
    query.data === 'sim_toggle_20br'
  ) {
    return;
  }

  try {
    await adminBot.answerCallbackQuery(query.id);

    switch (query.data) {

      case 'admin_players':
        await showPlayersMenu(chatId);
        break;

      case 'admin_balances':
        await showBalanceTotals(chatId);
        break;

      case 'admin_below50':
        await showPlayersBelow50(chatId);
        break;

      case 'admin_analysis':
        await showDataAnalysis(chatId);
        break;

      case 'admin_sms':
        await showPendingOfficialSMS(chatId);
        break;
    }

  } catch (error) {
    console.error('❌ Admin inline button error:', error);
  }
});
// ============================================================
// MESSAGE HANDLER
// ============================================================

adminBot.on('message', async (msg) => {
  if (!isAdmin(msg)) return;

  try {
    const chatId = msg.chat.id;
    const chatKey = String(chatId);
    const text = msg.text;

    if (!text) return;

    // ----------------------------
    // START
    // ----------------------------

    if (text === '/start') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);
      selectedPlayers.delete(chatKey);

      await showAdminPanel(chatId);
      return;
    }

    // ----------------------------
    // ADMIN PANEL
    // ----------------------------

    if (text === '🏠 ADMIN PANEL') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showAdminPanel(chatId);
      return;
    }

    // ----------------------------
    // PLAYERS
    // ----------------------------

    if (text === '👤 Players') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showPlayersMenu(chatId);
      return;
    }

    // ----------------------------
    // FIND PLAYER
    // ----------------------------

    if (text === '🔎 Find Player') {
      waitingForAmount.delete(chatKey);

      await askForPlayerPhone(chatId);
      return;
    }

    // ----------------------------
    // BALANCE ACTIONS
    // ----------------------------

    if (text === '➕ Add Main') {
      await startBalanceAction(chatId, 'addMain');
      return;
    }

    if (text === '➖ Remove Main') {
      await startBalanceAction(chatId, 'removeMain');
      return;
    }

    if (text === '🎁 Add Bonus') {
      await startBalanceAction(chatId, 'addBonus');
      return;
    }

    if (text === '➖ Remove Bonus') {
      await startBalanceAction(chatId, 'removeBonus');
      return;
    }
    if (text === '📋 Transactions') {
  await showPlayerTransactions(chatId);
  return;
}

    // ----------------------------
    // CANCEL
    // ----------------------------

    if (text === '❌ Cancel') {
      waitingForPhone.delete(chatKey);
      waitingForAmount.delete(chatKey);

      await showPlayersMenu(chatId);
      return;
    }

    // ----------------------------
    // AMOUNT INPUT
    // ----------------------------

    if (waitingForAmount.has(chatKey)) {
      await applyBalanceChange(chatId, text);
      return;
    }

    // ----------------------------
    // PHONE SEARCH
    // ----------------------------

    if (waitingForPhone.has(chatKey)) {
      waitingForPhone.delete(chatKey);

      await findPlayerByPhone(chatId, text);
      return;
    }

    // ----------------------------
    // BALANCES
    // ----------------------------
    if (text === '💰 Balances') {
      await showBalanceTotals(chatId);
      return;
    }

    if (text === '📊 Data Analysis') {
      await showDataAnalysis(chatId);
      return;
    }

    if (text === '⚠️ Below 50 Br') {
      await showPlayersBelow50(chatId);
      return;
    }

    if (text === '📩 Official SMS') {
      await showPendingOfficialSMS(chatId);
      return;
    }

  } catch (error) {
    console.error('❌ Admin bot error:', error);
  }
});

console.log('✅ Admin bot started');

module.exports = { adminBot, setGamesManager };