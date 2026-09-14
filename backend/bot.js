// ============================================================
// ZA BINGO — TELEGRAM BOT
// ============================================================
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const db = require('./firebase');

const welcomePhoto = path.join(__dirname, '../images/welcome.jpg');
const PROMOTION_IMAGE = path.join(__dirname, '../images/promotion.jpg');
const DAILY_WINNER_IMAGE = path.join(__dirname, '../images/daily-winner.jpg');

// Replace with your bot token from @BotFather
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-miniapp-url.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const BONUS_CHANNEL = '@EdelBingoo';
const ADMIN_ID =
  process.env.ADMIN_ID || 'YOUR_ADMIN_TELEGRAM_ID';
// ============================================================
// PRIVATE SUPPORT BOT
// ============================================================
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;

const supportBot = SUPPORT_BOT_TOKEN
  ? new TelegramBot(SUPPORT_BOT_TOKEN, { polling: true })
  : null;

  
function getEthiopiaTimeParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());

  const result = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = Number(part.value);
    }
  }

  return result;
}

// ============================================================
// ADMIN — SMS PARSERS
// ============================================================

function parseDepositSMS(text) {
  if (!text) return null;

  const amountMatch = text.match(
    /([\d,]+(?:\.\d{1,2})?)\s*(?:Br|ETB|ብር)/i
  );

  const transactionMatch = text.match(
    /\b([A-Z0-9]{8,})\b/
  );

  if (!amountMatch || !transactionMatch) {
    return null;
  }

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: transactionMatch[1].toUpperCase()
  };
}

function parseCBEBirrDepositSMS(text) {
  if (!text) return null;

  const amountMatch = text.match(
    /([\d,]+(?:\.\d{1,2})?)\s*(?:Br|ETB|ብር)/i
  );

  const transactionMatch = text.match(
    /\b([A-Z0-9]{8,})\b/
  );

  if (!amountMatch || !transactionMatch) {
    return null;
  }

  return {
    amount: Number(amountMatch[1].replace(/,/g, '')),
    transactionId: transactionMatch[1].toUpperCase(),
    bank: 'CBE Birr',
    type: 'received'
  };
}

async function findPendingTransaction(type, amount, transactionId) {
  const snapshot = await db.ref('transactions').once('value');
  const transactions = snapshot.val() || {};

  // Check duplicate transaction ID first
  for (const transaction of Object.values(transactions)) {
    if (!transaction) continue;

    if (
      String(transaction.transactionId || '').toUpperCase() ===
      String(transactionId || '').toUpperCase()
    ) {
      console.log('⚠️ Duplicate transaction ID:', transactionId);

      if (transaction.telegramId) {
        await bot.sendMessage(
          transaction.telegramId,
          `⚠️ *Duplicate ${type === 'deposit' ? 'Deposit' : 'Withdrawal'}*\n\n` +
          `This transaction has already been processed.\n` +
          `No money was added to your balance.`,
          { parse_mode: 'Markdown' }
        );
      }

      return null;
    }
  }

  // Find pending transaction
  for (const [key, transaction] of Object.entries(transactions)) {
    if (!transaction) continue;

    if (
      transaction.type === type &&
      transaction.status === 'pending' &&
      Number(transaction.amount) === Number(amount)
    ) {
      return {
        key,
        ...transaction
      };
    }
  }

  return null;
}

async function storeOfficialDeposit(text, smsData) {
  const officialRef = db.ref(
    `officialDeposits/${smsData.transactionId}`
  );

  const existingSnapshot = await officialRef.once('value');
  const existing = existingSnapshot.val();

  if (existing) {
    console.log(
      `⚠️ Official deposit already stored: ${smsData.transactionId}`
    );
    return false;
  }

  const receivedAt = new Date();
const expiresAt = new Date(
  receivedAt.getTime() + 3 * 24 * 60 * 60 * 1000
);

await officialRef.set({
  type: 'deposit',
  amount: smsData.amount,
  transactionId: smsData.transactionId,
  sms: text,
  status: 'available',
  receivedAt: receivedAt.toISOString(),
  expiresAt: expiresAt.toISOString()
});

  console.log(
    `✅ Official deposit SMS saved: ${smsData.amount} Br → ${smsData.transactionId}`
  );

  return true;
}

// ============================================================
// EXPIRE OLD OFFICIAL DEPOSITS
// ============================================================

setInterval(async () => {
  try {
    const snapshot = await db.ref('officialDeposits').once('value');
    const deposits = snapshot.val() || {};

    const now = Date.now();

    for (const [transactionId, deposit] of Object.entries(deposits)) {
      if (!deposit) continue;

      if (
        deposit.status === 'available' &&
        deposit.expiresAt &&
        now > new Date(deposit.expiresAt).getTime()
      ) {
        await db.ref(`officialDeposits/${transactionId}`).update({
          status: 'expired',
          expiredAt: new Date().toISOString()
        });

        console.log(
          `⏰ Official deposit expired: ${transactionId}`
        );
      }
    }

  } catch (error) {
    console.error(
      '❌ Deposit expiration error:',
      error
    );
  }

}, 60 * 60 * 1000);

async function processWithdrawal(text, smsData) {
  const transaction = await findPendingTransaction(
    'withdrawal',
    smsData.amount,
    smsData.transactionId
  );

  if (!transaction) {
    console.log(
      '⚠️ No matching pending withdrawal:',
      smsData.amount,
      smsData.transactionId
    );
    return false;
  }

  if (transaction.status !== 'pending') {
    console.log('⚠️ Withdrawal already processed:', transaction.key);
    return false;
  }

  // CBE → match amount + first name
  if (smsData.bank === 'CBE') {
    const requestName =
      String(transaction.firstName || '')
        .trim()
        .toLowerCase();

    const smsName =
      String(smsData.receiverFirstName || '')
        .trim()
        .toLowerCase();

    if (requestName !== smsName) {
      console.log(
        `❌ CBE name mismatch: ${requestName} ≠ ${smsName}`
      );
      return false;
    }
  }

  const transactionRef =
    db.ref(`transactions/${transaction.key}`);

  const playerRef =
    db.ref(`players/${transaction.telegramId}`);

  const playerSnapshot =
    await playerRef.once('value');

  const player =
    playerSnapshot.val();

  if (!player) {
    console.log(
      '❌ Player not found:',
      transaction.telegramId
    );
    return false;
  }

  const amount =
    Number(transaction.amount || 0);

  const source =
  transaction.withdrawSource ||
  (
    Number(transaction.mainAmount || 0) > 0
      ? 'main'
      : null
  );

  if (!source || amount <= 0) {
    console.log('❌ Invalid withdrawal source:', transaction.key);
    return false;
  }

  let remainingBalance = 0;

  if (source === 'main') {

    const result =
      await playerRef.child('balance').transaction(
        current => {
          const balance =
            Number(current || 0);

          if (balance < amount) {
            return;
          }

          return balance - amount;
        }
      );

    if (!result.committed) {
      console.log(
        `❌ Insufficient main balance: ${transaction.telegramId}`
      );
      return false;
    }

    remainingBalance =
      Number(result.snapshot.val() || 0);
  }

  else if (source === 'referral') {

    const gamesWon =
      Number(
        player.games_won ??
        player.gamesWon ??
        0
      );

    if (gamesWon < 10) {
      console.log(
        `❌ Referral withdrawal blocked: ${gamesWon}/10 wins`
      );
      return false;
    }

    const result =
      await playerRef
        .child('referralBonusBalance')
        .transaction(
          current => {
            const balance =
              Number(current || 0);

            if (balance < amount) {
              return;
            }

            return balance - amount;
          }
        );

    if (!result.committed) {
      console.log(
        `❌ Insufficient referral balance: ${transaction.telegramId}`
      );
      return false;
    }

    remainingBalance =
      Number(result.snapshot.val() || 0);
  }

  await transactionRef.update({
    status: 'approved',
    transactionId: smsData.transactionId,
    confirmedAt: new Date().toISOString(),
    confirmationSms: text
  });

const balanceName = 'Main balance';

  await bot.sendMessage(
    transaction.telegramId,
    `🧾 *ያዘዙት ወጪ ተረጋግጧል 💯*\n\n` +
    `Amount: ${amount.toFixed(2)} Br\n` +
    `Source: ${balanceName}\n` +
    `Transaction ID: ${smsData.transactionId}\n\n` +
    `💰 Remaining ${balanceName}: ${remainingBalance.toFixed(2)} Br`,
    {
      parse_mode: 'Markdown'
    }
  );

  console.log(
    `✅ Withdrawal approved: ${amount} Br → ${transaction.telegramId} (${source})`
  );

  return true;
}

    // --------------------------------------------------------
    // CHECK SMS FORWARDER SENDER
    // --------------------------------------------------------
async function processGatewaySMS(forwardedText) {
  try {

  if (!forwardedText) return;
    const senderMatch = forwardedText.match(/^From:\s*(\d+|CBEBirr|CBE)/i);

    if (!senderMatch) {
      console.log('❌ SMS sender not found');
      return;
    }

    const sender = senderMatch[1];

   // TRUST TELEBIRR + CBE SMS SENDERS
if (
  sender !== '127' &&
  sender.toUpperCase() !== 'CBE' &&
  sender.toUpperCase() !== 'CBEBIRR'
) {
  console.log(
    `❌ Unauthorized SMS sender: ${sender}`
  );
  return;
}

console.log(`✅ Authorized SMS sender: ${sender}`);

    // --------------------------------------------------------
    // REMOVE FORWARDER HEADER
    // --------------------------------------------------------

    const smsText = forwardedText
  .replace(/^From:\s*(?:\d+|CBEBirr|CBE)\s*/i, '')
  .replace(/^Time:\s*[^\n\r]*/i, '')
  .trim();

    console.log('\n📨 Actual SMS:');
    console.log(smsText);

    // --------------------------------------------------------
    // DEPOSIT SMS
    // --------------------------------------------------------

    // --------------------------------------------------------
// DEPOSIT SMS — EXISTING FORMAT
// --------------------------------------------------------
const smsData = parseDepositSMS(smsText);

if (smsData) {
  await storeOfficialDeposit(smsText, smsData);
  return;
}

// --------------------------------------------------------
// CBE BIRR DEPOSIT SMS
// --------------------------------------------------------
const cbeBirrData = parseCBEBirrDepositSMS(smsText);

if (cbeBirrData) {
  await storeOfficialDeposit(smsText, cbeBirrData);
  return;
}

    // --------------------------------------------------------
    // WITHDRAWAL SMS
    // --------------------------------------------------------

    if (
      smsText.includes('ልከዋል') &&
      smsText.includes('የሂሳብ እንቅስቃሴ ቁጥርዎ')
    ) {

      const smsData = parseWithdrawalSMS(smsText);

      if (!smsData) {
        console.log('❌ Could not parse withdrawal SMS');
        return;
      }

      await processWithdrawal(smsText, smsData);

      return;
    }
    // --------------------------------------------------------
// CBE BANK WITHDRAWAL SMS
// --------------------------------------------------------

if (
  smsText.includes('A debit transaction of ETB') &&
  smsText.includes('mbreciept.cbe.com.et')
) {

  const smsData = parseCBEWithdrawalSMS(smsText);

  if (!smsData) {
    console.log('❌ Could not parse CBE withdrawal SMS');
    return;
  }

  await processWithdrawal(smsText, smsData);

  return;
}

    console.log('ℹ️ SMS format not recognized');

    } catch (error) {
    console.error(
      '❌ SMS processing error:',
      error
    );
  }
}
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;

    await processGatewaySMS(msg.text);

  } catch (error) {
    console.error('❌ Telegram SMS processing error:', error);
  }
});

bot.setMyCommands([
  { command: 'play', description: 'Play Now' },
  { command: 'deposit', description: 'Deposit' },
  { command: 'withdraw', description: 'Withdraw' },
  { command: 'balance', description: 'Balance' },
  { command: 'instructions', description: 'Instructions' },
  { command: 'transfer', description: 'Transfer to a Player' },
  { command: 'profile', description: 'Profile' }
]);

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  bot.sendMessage(
  chatId,
  `💰 Main Balance: ${Number(player.balance || 0).toFixed(2)} Br\n` +
  `🎁 Referral Balance: ${Number(player.referralBonusBalance || 0).toFixed(2)} Br`
);
});
bot.onText(/\/transfer/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }
const deposited = await hasMadeDeposit(tgId);

if (!deposited) {
  return bot.sendMessage(
    chatId,
    '❌ You must make at least one deposit before you can transfer money.'
  );
}
  bot.sendMessage(
    chatId,
    'የተቀባዩን ስልክ ቁጥር ያስገቡ፦'
  );

  transferSessions[chatId] = {
    step: 'phone',
    senderId: tgId
  };
});
bot.onText(/\/play/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  showMainMenu(chatId);
});

bot.onText(/\/deposit/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  handleDepositMenu(chatId, player);
});

bot.onText(/\/withdraw/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  const deposited = await hasMadeDeposit(tgId);

  if (!deposited) {
    return bot.sendMessage(
      chatId,
      `❌ *ገንዘብ ማውጣት አይችሉም*\n\n` +
      `ገንዘብ ማውጣት ከመቻልዎ በፊት ቢያንስ አንድ ጊዜ ዴፖዚት ማድረግ አለብዎት።`,
      { parse_mode: 'Markdown' }
    );
  }

  handleWithdrawMenu(chatId, player);
});

bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);

  const snapshot = await db.ref(`players/${tgId}`).once('value');
  const player = snapshot.val();

  if (!player) {
    return bot.sendMessage(chatId, 'Please /start first.');
  }

  handleProfile(chatId, player);
});
let gameManager = null;

// ============================================================
// BOT COMMANDS
// ============================================================

// /start - Register user and show main menu
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;

  // Save user for future broadcasts
  broadcastUsers[String(chatId)] = true;

  const tgId = String(msg.from.id);
  const firstName = msg.from.first_name || 'Player';
  const username = msg.from.username || '';

  try {
    const playerRef = db.ref(`players/${tgId}`);
    const snapshot = await playerRef.once('value');
    let player = snapshot.val();

    if (!player) {
  // Register new player



  player = {
    telegram_id: tgId,
    first_name: firstName,
    username: username,
    phone: '',
    balance: 15,
games_played: 0,
games_won: 0,
    registration_date: new Date().toISOString(),


  };

  await playerRef.set(player);
            // 

      bot.sendPhoto(
  chatId,
  welcomePhoto,
  {
    caption:
      `👑 *እንኳን ደህና መጡ, ${firstName}!*\n\n` +
      `🎁 *15 ብር ቦነስ ተሰጥቶዎታል!*\n\n` +
      `🎱 *እድል Bingo — ይጫወቱ፣ ያሸንፉ! 🏆*\n\n` +
    
      `📲 *ምዝገባዎን ለመጨረስ ስልክ ቁጥርዎን ያጋሩ።*\n\n` +
      `****************👇👇👇****************`,
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [[
        {
          text: '📱 Share Contact',
          request_contact: true
        }
      ]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  }
);
    } else {
      showMainMenu(chatId);
    }

  } catch (error) {
    console.error('❌ /start error:', error);
    bot.sendMessage(
      chatId,
      '❌ Something went wrong. Please try again.'
    );
  }
});

// Handle contact sharing
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const phone = msg.contact.phone_number;

  try {
    await db.ref(`players/${tgId}/phone`).set(phone);

    bot.sendMessage(chatId,
  `✅ *የስልክ ቁጥርዎ ተመዝግቧል!*\n\n` +
  `🎱 *እንኳን ወደ እድል Bingo በደህና መጡ! 🏆*\n\n` +
  `🎮 *አሁን መጫወት ይችላሉ!*\n\n` +
  
  {
      reply_markup: {
        remove_keyboard: true
      }
    });

    showMainMenu(chatId);

  } catch (error) {
    console.error('❌ Contact save error:', error);

    bot.sendMessage(
      chatId,
      '❌ Could not save your phone number. Please try again.'
    );
  }
});

// ============================================================
// MAIN MENU
// ============================================================
function showMainMenu(chatId) {
  bot.sendMessage(chatId,
    ` *እድል BINGO*\n\n` +
    `Choose an option below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: ' Play Now', web_app: { url: WEBAPP_URL } }],
          [{ text: ' Deposit', callback_data: 'menu_deposit' }],
          [{ text: ' Withdraw', callback_data: 'menu_withdraw' }],
          [{ text: ' Profile', callback_data: 'menu_profile' }],
        ]
      }
    }
  );
}

// ============================================================
// CALLBACK HANDLERS
// ============================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const data = query.data;

  const playerRef = db.ref(`players/${tgId}`);
const snapshot = await playerRef.once('value');
const player = snapshot.val();
  if (!player) {
    bot.answerCallbackQuery(query.id, { text: 'Please /start first' });
    return;
  }

  // Transfer confirmation
  if (data === 'transfer_cancel') {
    delete transferSessions[chatId];

    await bot.answerCallbackQuery(query.id, {
      text: 'Transfer cancelled'
    });

    await bot.sendMessage(
      chatId,
      'Transfer cancelled.'
    );

    return;
  }

  if (data === 'transfer_confirm') {
    const session = transferSessions[chatId];

    if (!session || session.step !== 'confirm') {
      await bot.answerCallbackQuery(query.id, {
        text: 'Transfer session expired'
      });
      return;
    }

    const amount = Number(session.amount);
    const senderId = tgId;
    const recipientId = session.recipientId;

    // Get both players again before changing balances
    const senderRef = db.ref(`players/${senderId}`);
    const recipientRef = db.ref(`players/${recipientId}`);

    const [senderSnap, recipientSnap] = await Promise.all([
      senderRef.once('value'),
      recipientRef.once('value')
    ]);

    const sender = senderSnap.val();
    const recipient = recipientSnap.val();

    if (!sender || !recipient) {
      delete transferSessions[chatId];

      await bot.answerCallbackQuery(query.id, {
        text: 'Player not found'
      });

      await bot.sendMessage(chatId, '❌ Transfer failed.');
      return;
    }

    const senderBalance = Number(sender.balance || 0);

    if (amount <= 0 || amount > senderBalance) {
      delete transferSessions[chatId];

      await bot.answerCallbackQuery(query.id, {
        text: 'Insufficient balance'
      });

      await bot.sendMessage(
        chatId,
        `❌ Insufficient balance.\n\nYour balance: ${senderBalance} Br`
      );

      return;
    }

    // Deduct from sender
    await senderRef.child('balance').set(senderBalance - amount);

    // Add to recipient
    const recipientBalance = Number(recipient.balance || 0);

    await recipientRef
      .child('balance')
      .set(recipientBalance + amount);

    // Save transaction
    const transactionRef = db.ref('transactions').push();

    await transactionRef.set({
      type: 'transfer',
      senderId: senderId,
      recipientId: recipientId,
      amount: amount,
      status: 'completed',
      createdAt: new Date().toISOString()
    });

    delete transferSessions[chatId];

    await bot.answerCallbackQuery(query.id, {
      text: 'Transfer successful'
    });

    // Sender confirmation
    await bot.sendMessage(
      chatId,
      `✅ Transfer successful!\n\n` +
      `To: ${recipient.first_name || 'Player'}\n` +
      `Phone: ${recipient.phone || 'N/A'}\n` +
      `Amount: ${amount} Br\n\n` +
      `Remaining balance: ${senderBalance - amount} Br`
    );

    // Recipient notification
    await bot.sendMessage(
      recipientId,
      `You received ${amount} Br from ${sender.first_name || 'Player'}.\n\n` +
      `Your new balance: ${recipientBalance + amount} Br`
    );

    return;
  }

  // Menu handlers
if (data === 'menu_deposit') {
  await bot.answerCallbackQuery(query.id);
  return handleDepositMenu(chatId, player);
}

if (data === 'menu_withdraw') {

  const deposited = await hasMadeDeposit(tgId);

  if (!deposited) {

    await bot.answerCallbackQuery(query.id, {
      text: '❌ You must make a deposit first',
      show_alert: true
    });

    await bot.sendMessage(
      chatId,
      `❌ *ገንዘብ ማውጣት አይችሉም*\n\n` +
      `ገንዘብ ማውጣት ከመቻልዎ በፊት ቢያንስ አንድ ጊዜ ዴፖዚት ማድረግ አለብዎት።`,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  await bot.answerCallbackQuery(query.id);

  return handleWithdrawMenu(chatId, player);
}

if (data === 'menu_profile') {
  await bot.answerCallbackQuery(query.id);
  return handleProfile(chatId, player);
}
  // Deposit method selection
else if (data.startsWith('deposit_method_')) {
  const method = data.replace('deposit_method_', '');
  const session = depositSessions[chatId];

  if (!session || session.step !== 'method') {
    bot.sendMessage(chatId, '❌ Deposit session expired. Please start again.');
    return;
  }

  session.method = method;
  session.step = 'sms';

  if (method === 'telebirr') {
  bot.sendMessage(
    chatId,
    `💳 የቴሌብር አካውንት: \`0985661720\`\n\n` +
    `1️⃣ ከላይ ባለው የቴሌብር አካውንት ብር ያስገቡ\n\n` +
    `2️⃣ የምትልኩት የገንዘብ መጠን እና እዚህ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ\n\n` +
    `3️⃣ ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልእክት (SMS) ከቴሌብር ይደርሳችኋል\n\n` +
    `4️⃣ የደረሳችሁን SMS ሙሉውን Copy በማድረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያ ላይ Paste በማድረግ ይላኩት\n\n` +
    `⚠️ ማሳሰቢያ: የከፈላችሁበትን SMS ሙሉውን እዚህ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
} else if (method === 'cbe') {
  bot.sendMessage(
    chatId,
`💳 CBE Birr አካውንት: \`0985661720\`\n\n` +
`1️⃣ ከላይ ባለው CBE Birr አካውንት ብር ያስገቡ\n\n` +
`2️⃣ የምትልኩት የገንዘብ መጠን እና እዚህ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ\n\n` +
`3️⃣ ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልእክት (SMS) ከCBE Birr ይደርሳችኋል\n\n` +
`4️⃣ የደረሳችሁን SMS ሙሉውን Copy በማድረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያ ላይ Paste በማድረግ ይላኩት\n\n` +
`⚠️ ማሳሰቢያ: በCBE Birr አካውንት ብቻ ብር መላካችሁን እርግጠኛ ይሁኑ\n` +
`የከፈላችሁበትን SMS ሙሉውን እዚህ ላይ ያስገቡት 👇👇👇`,
    { parse_mode: 'Markdown' }
  );
}
}
// Withdraw method selection
else if (data === 'withdraw_source_main') {

  await bot.sendMessage(
    chatId,
    '⚠️ የገንዘብ ማውጣት አገልግሎት ለጊዜው አይሰራም። እባክዎ ቆይተው እንደገና ይሞክሩ።'
  );

  return;
}

else if (
  data === 'withdraw_method_telebirr' ||
  data === 'withdraw_method_cbe'
) {
  const session = withdrawSessions[chatId];

  if (!session || !session.source) {
    await bot.sendMessage(
      chatId,
      '❌ Withdrawal session expired. Please start again with /withdraw.'
    );
    delete withdrawSessions[chatId];
    return;
  }

  session.method =
    data === 'withdraw_method_cbe'
      ? 'cbe'
      : 'telebirr';

  session.step = 'amount';

  const sourceName =
    session.source === 'main'
      ? 'Main Balance'
      : 'Referral Bonus';

  await bot.sendMessage(
    chatId,
    `*${sourceName} Withdrawal*\n\n` +
    `የሚያወጡትን መጠን ያስገቡ 👇`,
    {
      parse_mode: 'Markdown'
    }
  );
}
  
  // Admin: Approve withdrawal
  else if (data.startsWith('approve_withdraw_')) {
    const txnId = data.replace('approve_withdraw_', '');
    approveWithdrawal(query, txnId);
  }
  // Admin: Reject withdrawal
  else if (data.startsWith('reject_withdraw_')) {
    const txnId = data.replace('reject_withdraw_', '');
    rejectWithdrawal(query, txnId);
  }

  bot.answerCallbackQuery(query.id);
});

// ============================================================
// SESSION STORAGE (In production, use Redis or DB)
// ============================================================
const depositSessions = {};
const withdrawSessions = {};
const transferSessions = {};
// ============================================================
// BROADCAST USERS
// ============================================================
const broadcastUsers = {};
// ============================================================
// TEXT MESSAGE HANDLER (for amount input)
// ============================================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Save user for future broadcasts
  broadcastUsers[String(chatId)] = true;

  const tgId = String(msg.from.id);
  const text = msg.text;

  // Skip commands and contacts
  if (!text || text.startsWith('/') || msg.contact) return;

  const playerRef = db.ref(`players/${tgId}`);
const snapshot = await playerRef.once('value');
const player = snapshot.val();

  // Handle deposit amount
if (depositSessions[chatId] && depositSessions[chatId].step === 'amount') {
  const amount = parseFloat(text);

  if (isNaN(amount) || amount < 50) {
  bot.sendMessage(chatId, '❌ Minimum deposit is 50 Br. Enter amount:');
  return;
}

  // Save amount and move to payment method
  depositSessions[chatId] = {
    step: 'method',
    amount: amount
  };

  bot.sendMessage(
    chatId,
    `ለማስገባት የፈለጉት: *${amount} Br*\n\nየመክፈያ አማራጭ ይምረጡ 👇:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: ' Telebirr', callback_data: 'deposit_method_telebirr' }],
          [{ text: ' CBE Birr', callback_data: 'deposit_method_cbe' }],
          [{ text: '🔙 Back', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );

  return;
}

  // Handle deposit SMS
if (
  depositSessions[chatId] &&
  depositSessions[chatId].step === 'sms'
) {
  const session = depositSessions[chatId];
  const amount = Number(session.amount);
  const method = session.method;
  const sms = text.trim();


let smsData = null;

// ============================================================
// PLAYER PAYMENT SMS PARSER
// Extract amount + transaction ID without depending on language
// ============================================================

// Convert common numeral systems to normal 0-9 digits
const normalizeDigits = (value) =>
  String(value || '')
    .replace(/[٠-٩]/g, d =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    )
    .replace(/[۰-۹]/g, d =>
      String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    );

const normalizedSms = normalizeDigits(sms);

// ------------------------------------------------------------
// 1. Find the amount
// ------------------------------------------------------------

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
    numericValue === amount
  ) {
    parsedAmount = amount;
    break;
  }
}

// ------------------------------------------------------------
// 2. Find the official transaction ID inside the SMS
// ------------------------------------------------------------

if (parsedAmount !== null) {

  const officialSnapshot =
    await db.ref('officialDeposits').once('value');

  const officialDeposits =
    officialSnapshot.val() || {};

  const compactSms =
    normalizedSms
      .replace(/[\s-]/g, '')
      .toUpperCase();

  for (const [id, official] of Object.entries(officialDeposits)) {

    if (!official) continue;

    if (official.status !== 'available') continue;

    if (Number(official.amount) !== parsedAmount) continue;

    const compactId =
      String(id)
        .replace(/[\s-]/g, '')
        .toUpperCase();

    if (compactSms.includes(compactId)) {

      smsData = {
        amount: parsedAmount,
        transactionId: String(id).toUpperCase()
      };

      break;
    }
  }
}

// Reject if parsing failed
if (!smsData) {
  bot.sendMessage(
    chatId,
    'ያስገቡት የትራንዛክሽን ቁጥር የተሳሳተ ነው። እባክዎ ሲከፍሉ የደረስዎትን የጹሁፍ መልዕክት(sms) ሙሉውን ኮፒ አርገው እዚህ ላይ ፔስት ያርጉት።'
  );
  return;
}

const smsAmount = Number(smsData.amount);

const transactionId =
  String(smsData.transactionId).toUpperCase();
  // Check that SMS amount matches the amount entered
  if (smsAmount !== amount) {
    bot.sendMessage(
      chatId,
      `❌ The SMS amount (${smsAmount} Br) does not match your deposit amount (${amount} Br).`
    );
    return;
  }

// Check official SMS saved by the main bot
  const officialRef = db.ref(
    `officialDeposits/${transactionId}`
  );

  const officialSnapshot =
    await officialRef.once('value');

  const official = officialSnapshot.val();

  if (!official || official.status !== 'available') {
    bot.sendMessage(
      chatId,
      '⏳ ይህን ክፍያ እስካሁን ማግኘት አልተቻለም። እባክዎ ትክክለኛውን የክፍያ SMS መልዕክት መድረሱን ያረጋግጡና እንደገና ይላኩ።'
    );
    return;
  }

  // Verify amount
  if (Number(official.amount) !== smsAmount) {
    bot.sendMessage(
      chatId,
      '❌ Payment verification failed.'
    );
    return;
  }

  // Check 3-day expiration
if (official.expiresAt) {
  if (Date.now() > new Date(official.expiresAt).getTime()) {
    bot.sendMessage(
      chatId,
      '❌ This payment SMS has expired.'
    );
    return;
  }
}

// Compare amount + transaction ID
if (
  Number(official.amount) !== smsAmount ||
  String(official.transactionId).toUpperCase() !==
    transactionId.toUpperCase()
) {
  bot.sendMessage(
    chatId,
    '❌ The SMS does not match the official payment record.'
  );
  return;
}

  // Create approved transaction
  const transactionRef =
    db.ref('transactions').push();

  await transactionRef.set({
    playerId: tgId,
    telegramId: tgId,
    type: 'deposit',
    amount: amount,
    status: 'approved',
    paymentMethod: method,
    sms: sms,
    transactionId: transactionId,
    officialDepositId: transactionId,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString()
  });

  // Add money to player's balance
  const balanceRef = db.ref(
    `players/${tgId}/balance`
  );

  const balanceResult =
    await balanceRef.transaction(
      balance => Number(balance || 0) + amount
    );

  const newBalance =
    Number(balanceResult.snapshot.val() || 0);
      

  // Mark official SMS as used
  await officialRef.update({
    status: 'used',
    usedBy: String(tgId),
    usedTransaction: transactionRef.key,
    usedAt: new Date().toISOString()
  });

  await bot.sendMessage(
  chatId,
  `🧾 *ሂሳብዎ ገብቷል*\n\n` +
  `Receiver phone:  ${player.phone || 'N/A'}\n` +
  `Amount:          ${amount.toFixed(2)} ETB\n` +
  `Reference:       ${transactionId}\n\n` +
  `💰 New balance:   ${newBalance.toFixed(2)} ETB`,
  { parse_mode: 'Markdown' }
);

  delete depositSessions[chatId];
  return;
}

// ============================================================
// HANDLE WITHDRAWAL
// ============================================================

if (withdrawSessions[chatId]) {

  const session = withdrawSessions[chatId];

  // ----------------------------------------------------------
  // STEP 1 — AMOUNT
  // ----------------------------------------------------------

  if (session.step === 'amount') {

  const amount = parseFloat(text);

  if (!Number.isFinite(amount) || amount <= 0) {
    await bot.sendMessage(
      chatId,
      '❌ የተሳሳተ መጠን ነው። እባክዎ የሚያወጡትን መጠን እንደገና ያስገቡ።'
    );
    return;
  }

  let availableBalance = 0;

  // ==========================================
  // MAIN BALANCE
  // NO 10-WIN REQUIREMENT
  // ==========================================
  if (session.source === 'main') {

    availableBalance =
      Number(player.balance || 0);

  }

  // 

  else {
    await bot.sendMessage(
      chatId,
      '❌ Withdrawal session expired. Please start again.'
    );

    delete withdrawSessions[chatId];
    return;
  }

  if (amount > availableBalance) {

    await bot.sendMessage(
      chatId,
      `❌ Insufficient balance.\n\n` +
      `Available: ${availableBalance.toFixed(2)} Br`
    );

    return;
  }

  session.amount = amount;
  session.step = 'phone';

  await bot.sendMessage(
    chatId,
    session.method === 'cbe'
      ? `🍂 ገንዘቡን የሚቀበሉበትን CBE አካውንት ቁጥር ያስገቡ 👇`
      : `📱 ገንዘቡን የሚቀበሉበትን የስልክ ቁጥር ያስገቡ 👇`
  );

  return;
}


  // ----------------------------------------------------------
  // STEP 2 — PHONE / CBE ACCOUNT
  // ----------------------------------------------------------

  if (session.step === 'phone') {

    const input = text.trim();

    // CBE → ACCOUNT NUMBER
    if (session.method === 'cbe') {

      if (!/^\d+$/.test(input)) {
        await bot.sendMessage(
          chatId,
          `❌ የተሳሳተ የCBE አካውንት ቁጥር ነው።`
        );
        return;
      }

      session.phone = input;
      session.step = 'firstName';

      await bot.sendMessage(
        chatId,
        `👤 የመጀመሪያ ስምዎን ያስገቡ 👇`
      );

      return;
    }

    // TELEBIRR → PHONE NUMBER
    const normalizedPhone = input.replace(/\D/g, '');

    if (
      !(
        normalizedPhone.startsWith('09') &&
        normalizedPhone.length === 10
      ) &&
      !(
        normalizedPhone.startsWith('2519') &&
        normalizedPhone.length === 12
      )
    ) {
      await bot.sendMessage(
        chatId,
        `❌ የተሳሳተ የስልክ ቁጥር ነው።\n\n` +
        `ለምሳሌ፦ 09XXXXXXXX`
      );
      return;
    }

    session.phone = input;

    // Telebirr continues to create the request below.
  }


  // ----------------------------------------------------------
  // STEP 3 — CBE FIRST NAME
  // ----------------------------------------------------------

  if (session.step === 'firstName') {

    const firstName = text.trim();

    if (!firstName) {
      await bot.sendMessage(
        chatId,
        `❌ እባክዎ የመጀመሪያ ስምዎን ያስገቡ።`
      );
      return;
    }

    session.firstName = firstName;
  }


  // ----------------------------------------------------------
  // ONLY CREATE REQUEST AFTER ALL REQUIRED INFORMATION
  // ----------------------------------------------------------

  if (
    session.method === 'cbe' &&
    (!session.phone || !session.firstName)
  ) {
    return;
  }

  if (
    session.method === 'telebirr' &&
    !session.phone
  ) {
    return;
  }

  const phone = session.phone;
  const requestedAmount = Number(session.amount);

  const freshSnapshot =
  await db.ref(`players/${tgId}`).once('value');

const freshPlayer =
  freshSnapshot.val();

if (!freshPlayer) {
  await bot.sendMessage(
    chatId,
    '❌ Player account not found.'
  );

  delete withdrawSessions[chatId];
  return;
}


let availableBalance = 0;

if (session.source === 'main') {

  availableBalance =
    Number(freshPlayer.balance || 0);

}

else if (session.source === 'referral') {

  const gamesWon =
    Number(
      freshPlayer.games_won ??
      freshPlayer.gamesWon ??
      0
    );

  if (gamesWon < 10) {
    await bot.sendMessage(
      chatId,
      `❌ You need at least 10 wins to withdraw referral money.\n\n` +
      `🏆 Your wins: ${gamesWon}/10`
    );

    delete withdrawSessions[chatId];
    return;
  }

  availableBalance =
    Number(
      freshPlayer.referralBonusBalance || 0
    );

}

else {

  await bot.sendMessage(
    chatId,
    '❌ Invalid withdrawal source.'
  );

  delete withdrawSessions[chatId];
  return;
}

if (requestedAmount > availableBalance) {

  await bot.sendMessage(
    chatId,
    `❌ Insufficient balance.\n\n` +
    `Available: ${availableBalance.toFixed(2)} Br`
  );

  delete withdrawSessions[chatId];
  return;
}

  // ----------------------------------------------------------
  // CREATE PENDING WITHDRAWAL
  // ----------------------------------------------------------

  const balanceField = 'balance';

const newBalance =
  availableBalance - requestedAmount;

await playerRef
  .child(balanceField)
  .set(newBalance);

  const transactionRef =
    db.ref('transactions').push();

  await transactionRef.set({
  playerId: tgId,
  telegramId: tgId,

  type: 'withdrawal',

  amount: requestedAmount,

  withdrawSource: session.source,

  mainAmount:
    session.source === 'main'
      ? requestedAmount
      : 0,

  

  status: 'pending',
balanceDeducted: true,

  paymentMethod: session.method,

  withdrawalPhone: phone,

  firstName:
    session.method === 'cbe'
      ? session.firstName
      : '',

  createdAt: new Date().toISOString()
});


  // ----------------------------------------------------------
  // ADMIN NOTIFICATION
  // ----------------------------------------------------------

  await bot.sendMessage(
    ADMIN_ID,
    `💰 *New Withdrawal Request*\n\n` +
    `Player: ${player.first_name || 'Player'}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Amount: ${Number(session.amount).toFixed(2)} Br\n` +
    `Method: ${
      session.method === 'telebirr'
        ? 'Telebirr'
        : 'CBE Birr'
    }\n` +
    `Phone/Account: ${phone}\n` +
    `${
      session.method === 'cbe'
        ? `First Name: ${session.firstName}\n`
        : ''
    }` +
    `Date: ${new Date().toLocaleString()}`,
    {
      parse_mode: 'Markdown'
    }
  );


  // ----------------------------------------------------------
  // PLAYER CONFIRMATION
  // ----------------------------------------------------------

  await bot.sendMessage(
    chatId,
    `🧾 *የገንዘብ ማውጣት ጥያቄዎ ተልኳል* ✅\n\n` +
    `💰 መጠን: ${Number(session.amount).toFixed(2)} Br\n` +
    `💳 መንገድ: ${
      session.method === 'telebirr'
        ? 'Telebirr'
        : 'CBE Birr'
    }\n` +
    `📱 ${
      session.method === 'cbe'
        ? 'አካውንት'
        : 'ስልክ'
    }: ${phone}\n\n` +
    `⏳ ሁኔታ: Pending\n` +
    `💰 Main balance: ${Number(freshPlayer.balance || 0).toFixed(2)} Br\n` +

    {
      parse_mode: 'Markdown'
    }
  );


  // ----------------------------------------------------------
  // CLEAR SESSION
  // ----------------------------------------------------------

  delete withdrawSessions[chatId];

  return;
}
  // ============================================================
// HANDLE PLAYER TRANSFER
// ============================================================

if (transferSessions[chatId]) {
  const session = transferSessions[chatId];

  // Step 1: Phone number
  if (session.step === 'phone') {
    const phone = text.trim();

    const playersSnapshot = await db.ref('players').once('value');
    const players = playersSnapshot.val() || {};

    let recipientId = null;
    let recipient = null;

    for (const [id, p] of Object.entries(players)) {
      if (!p) continue;

      const normalizePhone = (number) => {
  let phone = String(number || '').replace(/\D/g, '');

  if (phone.startsWith('251')) {
    phone = phone.slice(3);
  }

  if (phone.startsWith('0')) {
    phone = phone.slice(1);
  }

  return phone;
};

const savedPhone = normalizePhone(p.phone);
const enteredPhone = normalizePhone(phone);

if (savedPhone === enteredPhone) {
  recipientId = id;
  recipient = p;
  break;
}
    }

    if (!recipient) {
      bot.sendMessage(
        chatId,
        '❌ No player was found with this phone number.'
      );
      return;
    }

    if (recipientId === tgId) {
      bot.sendMessage(
        chatId,
        '❌ You cannot transfer money to yourself.'
      );
      return;
    }

    session.recipientId = recipientId;
    session.recipient = recipient;
    session.step = 'amount';

    bot.sendMessage(
      chatId,
      `Recipient: ${recipient.first_name || 'Player'}\n\n` +
      `Enter the amount to transfer:`
    );

    return;
  }

  // Step 2: Amount
  if (session.step === 'amount') {
    const amount = Number(text);

    if (!Number.isFinite(amount) || amount < 10) {
      bot.sendMessage(
        chatId,
        '❌ Invalid amount. Enter the amount again:'
      );
      return;
    }

    const balance = Number(player.balance || 0);

    if (amount > balance) {
      bot.sendMessage(
        chatId,
        `❌ Insufficient balance.\n\nYour balance: ${balance} Br`
      );
      return;
    }

    session.amount = amount;
    session.step = 'confirm';

    bot.sendMessage(
      chatId,
      `Transfer Confirmation\n\n` +
      `To: ${session.recipient.first_name || 'Player'}\n` +
      `Phone: ${session.recipient.phone}\n` +
      `Amount: ${amount} Br\n\n` +
      `Confirm this transfer?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'transfer_confirm'
              },
              {
                text: 'Cancel',
                callback_data: 'transfer_cancel'
              }
            ]
          ]
        }
      }
    );

    return;
  }
}
});

function isAdmin(telegramId) {
  return String(telegramId) === String(ADMIN_ID);
}

// ============================================================
// ADMIN — APPROVE WITHDRAWAL
// ============================================================

async function approveWithdrawal(query, txnId) {
  const chatId = query.message.chat.id;
  const adminId = String(query.from.id);

  if (!isAdmin(adminId)) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin only',
      show_alert: true
    });
    return;
  }

  try {

    const transactionRef =
      db.ref(`transactions/${txnId}`);

    const snapshot =
      await transactionRef.once('value');

    const transaction =
      snapshot.val();

    if (!transaction) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Transaction not found',
        show_alert: true
      });
      return;
    }

    if (transaction.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, {
        text: '⚠️ Already processed',
        show_alert: true
      });
      return;
    }

    const playerId =
      String(transaction.telegramId);

    const amount =
      Number(transaction.amount || 0);

const source =
  transaction.withdrawSource ||
  (
    Number(transaction.mainAmount || 0) > 0
      ? 'main'
      : null
  );

    if (!source || amount <= 0) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Invalid withdrawal source',
        show_alert: true
      });
      return;
    }

    const playerRef =
      db.ref(`players/${playerId}`);

    let remainingBalance = 0;

    // ==========================================
    // MAIN BALANCE WITHDRAWAL
    // ==========================================
    if (source === 'main') {

const balanceSnapshot =
  await playerRef.child('balance').once('value');

remainingBalance =
  Number(balanceSnapshot.val() || 0);
}
    // 
    // ==========================================
    // MARK TRANSACTION APPROVED
    // ==========================================
    await transactionRef.update({
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: adminId
    });

 const balanceName = 'Main balance';

    await bot.sendMessage(
      playerId,
      `✅ *Withdrawal approved!*\n\n` +
      `Amount: ${amount.toFixed(2)} Br\n` +
      `Source: ${balanceName}\n` +
      `Phone: ${transaction.withdrawalPhone || 'N/A'}\n\n` +
      `💰 Remaining ${balanceName}: ${remainingBalance.toFixed(2)} Br`,
      {
        parse_mode: 'Markdown'
      }
    );

    await bot.answerCallbackQuery(query.id, {
      text: '✅ Withdrawal approved'
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    );

    await bot.sendMessage(
      chatId,
      `✅ Withdrawal approved.\n\n` +
      `Player: ${playerId}\n` +
      `Amount: ${amount.toFixed(2)} Br\n` +
      `Source: ${balanceName}`
    );

  } catch (error) {

    console.error(
      '❌ Approve withdrawal error:',
      error
    );

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Approval failed',
      show_alert: true
    });
  }
}

// ============================================================
// ADMIN — REJECT WITHDRAWAL
// ============================================================

async function rejectWithdrawal(query, txnId) {
  const chatId = query.message.chat.id;
  const adminId = String(query.from.id);

  if (!isAdmin(adminId)) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin only',
      show_alert: true
    });
    return;
  }

  try {
    const transactionRef = db.ref(`transactions/${txnId}`);
    const snapshot = await transactionRef.once('value');
    const transaction = snapshot.val();

    if (!transaction) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Transaction not found',
        show_alert: true
      });
      return;
    }

    if (transaction.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, {
        text: '⚠️ Already processed',
        show_alert: true
      });
      return;
    }
    const playerRef = db.ref(`players/${transaction.playerId}`);

const balanceField = 'balance';

await playerRef.child(balanceField).transaction(current => {
  return Number(current || 0) + Number(transaction.amount || 0);
});

    await transactionRef.update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: adminId
    });

    await bot.sendMessage(
      transaction.telegramId,
      `❌ *Withdrawal rejected.*\n\n` +
      `Amount: ${transaction.amount} Br\n` +
      `Phone: ${transaction.withdrawalPhone || 'N/A'}`,
      { parse_mode: 'Markdown' }
    );

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Withdrawal rejected'
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    );

    await bot.sendMessage(
      chatId,
      `❌ Withdrawal rejected.\n\n` +
      `Amount: ${transaction.amount} Br`
    );

  } catch (error) {
    console.error('❌ Reject withdrawal error:', error);

    await bot.answerCallbackQuery(query.id, {
      text: '❌ Rejection failed',
      show_alert: true
    });
  }
}

    

// ============================================================
// HANDLERS
// ============================================================
function handleDepositMenu(chatId, player) {
  bot.sendMessage(
    chatId,
    ` *ገንዘብ ለማስገባት*\n\n` +
    `ቀሪ ሂሳብ: ${player.balance} Br\n\n` +
    `ማስገባት የሚፈልጉትን መጠን ያስገቡ 👇 ( ዝቅተኛ 50 ብር):`,
    { parse_mode: 'Markdown' }
  );

  depositSessions[chatId] = {
    step: 'amount'
  };
}
// ============================================================
// CHECK WITHDRAWAL DEPOSIT REQUIREMENT
// Player must have at least ONE approved deposit
// ============================================================

async function hasMadeDeposit(telegramId) {
  const snapshot = await db
    .ref('transactions')
    .orderByChild('telegramId')
    .equalTo(String(telegramId))
    .once('value');

  const transactions = snapshot.val() || {};

  return Object.values(transactions).some(transaction =>
    transaction &&
    transaction.type === 'deposit' &&
    transaction.status === 'approved'
  );
}

function handleWithdrawMenu(chatId, player) {
  const mainBalance = Number(player.balance || 0);

  bot.sendMessage(
    chatId,
    `*ገንዘብ ለማውጣት*\n\n` +
    `💰 Main balance: ${mainBalance.toFixed(2)} Br\n\n` +
    `የሚያወጡትን ሂሳብ ይምረጡ 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Main Balance', callback_data: 'withdraw_source_main' }],
          [{ text: '🔙 Back', callback_data: 'back_to_menu' }]
        ]
      }
    }
  );
}
function handleProfile(chatId, player) {
  const mainBalance =
    Number(player.balance || 0);

  bot.sendMessage(
    chatId,
    `*Profile*\n\n` +
    `Name: ${player.first_name || 'N/A'}\n` +
    `Username: @${player.username || 'N/A'}\n` +
    `Phone: ${player.phone || 'Not set'}\n\n` +
    `💰 *Main Balance:* ${mainBalance.toFixed(2)} Br\n\n` +
    `Games Played: ${player.games_played ?? player.gamesPlayed ?? 0}\n` +
    `Games Won: ${player.gamesWon ?? player.games_won ?? 0}\n` +
    `Joined: ${player.registration_date || 'N/A'}`,
    {
      parse_mode: 'Markdown'
    }
  );
}

// ============================================================
// ADMIN FUNCTIONS
// ============================================================


// ============================================================
// GAME MANAGER INTEGRATION
// ============================================================
function setGameManager(gm) {
  gameManager = gm;
}

// ============================================================
// DAILY + WEEKLY BONUS SYSTEM
//
// DAILY  → Every day at 10:30 PM Ethiopia
// WEEKLY → Every Sunday at 10:30 PM Ethiopia
//
// RULES:
// Real player  → 1 actual win = 1 leaderboard win
// Sim player   → 3 actual wins = 1 leaderboard win
//
// Daily  → Top 3
// Weekly → Top 5
//
// IMPORTANT:
// winners/ is NEVER deleted.
// Announcement happens BEFORE reset.
// Daily and Weekly are separate.
// ============================================================

let lastDailyBonusDate = null;

// ============================================================
// ETHIOPIA DATE HELPER
// ============================================================

function getEthiopiaDate(date) {

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(date));

  const p = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value);
    }
  }

  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}


// ============================================================
// CONVERT ACTUAL WINS → LEADERBOARD WINS
// ============================================================

function calculateLeaderboardWins(playerId, actualWins) {
  return actualWins;
}


// ============================================================
// DAILY + WEEKLY CHECK
// ============================================================

setInterval(async () => {

  try {

    const now = getEthiopiaTimeParts();

    // ========================================================
    // ONLY RUN AT 10:30 PM ETHIOPIA TIME
    // ========================================================

    if (now.hour !== 22 || now.minute !== 30) {
      return;
    }

    const today =
      `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;


    // ========================================================
    // GET ALL WINNER HISTORY
    //
    // NEVER DELETE winners/
    // ========================================================

    const snapshot = await db.ref('winners').once('value');

    const data = snapshot.val() || {};

    const allWinners = Object.values(data);


    // 
      
    if (lastDailyBonusDate !== today) {

  console.log('🏆 CALCULATING DAILY LEADERBOARD...');

  // The daily leaderboard period that just finished
  // is the period BEFORE the current 10:30 PM cutoff.
  const previousDate = new Date(
    Date.UTC(now.year, now.month - 1, now.day - 1)
  );

  const dailyKey =
    `${previousDate.getUTCFullYear()}-${String(
      previousDate.getUTCMonth() + 1
    ).padStart(2, '0')}-${String(
      previousDate.getUTCDate()
    ).padStart(2, '0')}`;

  // Read the SAME leaderboard used by the website
  const dailySnapshot = await db.ref(
    `dailyLeaderboard/${dailyKey}`
  ).once('value');

  const dailyData = dailySnapshot.val() || {};

  const dailyTop3 =
    Object.entries(dailyData)
      .map(([playerId, player]) => ({
        playerId: String(playerId),
        playerName: player.name || 'Player',
        wins: Number(player.wins || 0)
      }))
      .filter(player => player.wins > 0)
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 3);

  const dailyNames = [
    dailyTop3[0]
      ? `${dailyTop3[0].playerName} (${dailyTop3[0].wins})`
      : 'No winner',

    dailyTop3[1]
      ? `${dailyTop3[1].playerName} (${dailyTop3[1].wins})`
      : 'No winner',

    dailyTop3[2]
      ? `${dailyTop3[2].playerName} (${dailyTop3[2].wins})`
      : 'No winner'
  ];

  const dailyMessage =
`🏆 የዕለታዊ ቦነስ ተሸላሚዎች 🏆

🥇 1ኛ ደረጃ — ${dailyNames[0]} 💰 500 ብር
🥈 2ኛ ደረጃ — ${dailyNames[1]} 💰 250 ብር
🥉 3ኛ ደረጃ — ${dailyNames[2]} 💰 100 ብር

🎉 አሸናፊዎች እንኳን ደስ አላችሁ!
🎱 ይጫወቱ ያሸንፉ ይሸለሙ!
🎁 የ15 ብር ቦነስ ያግኙ!

https://t.me/ZABingo_bot

❤️ Edel Bingo — መልካም ጨዋታ!`;

  await bot.sendPhoto(
    BONUS_CHANNEL,
    DAILY_WINNER_IMAGE,
    {
      caption: dailyMessage
    }
  );

  console.log('✅ DAILY BONUS POSTED');

  // DO NOT delete dailyLeaderboard/${dailyKey}.
  // The website needs the historical daily period.
  // The next period automatically uses a new dailyKey.

  lastDailyBonusDate = today;

  console.log(
    `✅ DAILY LEADERBOARD COMPLETED FOR ${dailyKey}`
  );
}


    // 


  } catch (error) {

    console.error(
      '❌ DAILY/WEEKLY BONUS ERROR:',
      error
    );

  }

}, 30 * 1000);
// ============================================================
// DAILY PROMOTIONAL ANNOUNCEMENT
// 2:00 PM + 8:00 PM ETHIOPIA TIME
// ============================================================

const PROMO_CHANNELS = [
  '@EdelBingoo',
  '@ethiotictok',
  '@Edelcrypto',
  '@Edelsportnews',
  '@ethiohotenew',
  '@yareddish'
];

const promoMessage = `
🏆 EDEL BINGO — DAILY BONUS 🏆
🎱 ይጫወቱ • ያሸንፉ • ይሸለሙ! 🎱
━━━━━━━━━━━━━━━━━━
🌟 የዕለታዊ ቦነስ ተሸላሚዎች 🌟
🥇 1ኛ ደረጃ — Player 1 💰 500 ብር
🥈 2ኛ ደረጃ — Player 2 💰 250 ብር
🥉 3ኛ ደረጃ — Player 3 💰 100 ብር
🎉 🎉
🔥 ብዙ ይጫወቱ
🏆 ብዙ ያሸንፉ
💰 ብዙ ይሸለሙ!
━━━━━━━━━━━━━━━━━━
🎁 15 ብር የመጫወቻ ቦነስ ያግኙ!
━━━━━━━━━━━━━━━━━━
👉 አሁኑኑ ይጫወቱ:
https://t.me/ZABingo_bot

📢 ለተጨማሪ መረጃ የእኛን Telegram Channel ይቀላቀሉ! 👇

👉 https://t.me/EdelBingoo

❤️ Edel Bingo — መልካም ጨዋታ!
`;
let lastPromoDate = '';
let lastPromoHour = null;

setInterval(async () => {

  try {

    const now = getEthiopiaTimeParts();

    // Only 2:00 PM or 8:00 PM
    if (
      now.minute !== 0 ||
      (now.hour !== 14 && now.hour !== 20)
    ) {
      return;
    }

    const today =
      `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;

    // Prevent duplicate posts during the same hour
    if (
      lastPromoDate === today &&
      lastPromoHour === now.hour
    ) {
      return;
    }

    console.log(
      `📢 Sending promotional announcement at ${now.hour}:00`
    );

    // --------------------------------------------------------
    // POST TO CHANNEL
    // --------------------------------------------------------

    for (const channel of PROMO_CHANNELS) {
  try {
    await bot.sendPhoto(
  channel,
  PROMOTION_IMAGE,
  {
    caption: promoMessage
  }
);
  } catch (error) {
    console.error(`❌ Could not post to ${channel}:`, error.message);
  }
}

    console.log('✅ Promo posted to channel');

    // --------------------------------------------------------
    // SEND TO BOT USERS
    // --------------------------------------------------------

    for (const chatId of Object.keys(broadcastUsers)) {

      try {

        await bot.sendPhoto(
  chatId,
  PROMOTION_IMAGE,
  {
    caption: promoMessage
  }
);

      } catch (error) {

        console.error(
          `❌ Could not send promo to ${chatId}:`,
          error.message
        );

      }

    }

    lastPromoDate = today;
    lastPromoHour = now.hour;

    console.log('✅ Promo broadcast completed');

  } catch (error) {

    console.error(
      '❌ PROMO BROADCAST ERROR:',
      error
    );

  }

  }, 30 * 1000);


// ============================================================
// WITHDRAWAL APOLOGY BROADCAST
// SENDS ONLY 2 TIMES: 10:00 AM AND 10:00 PM ETHIOPIA TIME
// ============================================================

const withdrawalApologyMessage = `
🙏 ይቅርታ ውድ የEdel Bingo ተጫዋቾች

በአሁኑ ጊዜ የWithdrawal አገልግሎታችን ላይ ጊዜያዊ ችግር እየተከሰተ ስለሆነ የWithdrawal ጥያቄዎችን ለጊዜው መቀበል አቁመናል።

🙏 ለሚያደርስባችሁ እንግልት በጣም እንጠይቃለን።

🔧 ችግሩን ለመፍታት እየሰራን ነው።
✅ አገልግሎቱ እንደተመለሰ እናሳውቃችኋለን።

❤️ ስለ ትዕግስታችሁና ስለ ትብብራችሁ እናመሰግናለን።

Edel Bingo — መልካም ጨዋታ!
`;

let withdrawalApologyPostsSent = 0;

setInterval(async () => {

  try {

    // STOP FOREVER AFTER 2 POSTS
    if (withdrawalApologyPostsSent >= 2) {
      return;
    }

    const now = getEthiopiaTimeParts();

    // ONLY RUN AT 10:00 AM OR 10:00 PM ETHIOPIA TIME
    if (
      now.minute !== 0 ||
      (now.hour !== 10 && now.hour !== 22)
    ) {
      return;
    }

    console.log(
      `🙏 Sending withdrawal apology post #${withdrawalApologyPostsSent + 1} at ${now.hour}:00`
    );

    // --------------------------------------------------------
    // SEND TO BOT USERS
    // --------------------------------------------------------

    for (const chatId of Object.keys(broadcastUsers)) {

      try {

        await bot.sendMessage(
          chatId,
          withdrawalApologyMessage
        );

      } catch (error) {

        console.error(
          `❌ Could not send withdrawal apology to ${chatId}:`,
          error.message
        );

      }

    }

    // Count the post ONLY after the broadcast attempt
    withdrawalApologyPostsSent++;

    console.log(
      `✅ Withdrawal apology broadcast #${withdrawalApologyPostsSent} completed`
    );

  } catch (error) {

    console.error(
      '❌ WITHDRAWAL APOLOGY BROADCAST ERROR:',
      error
    );

  }

}, 30 * 1000);

// ============================================================
// PRIVATE SUPPORT SYSTEM
// ============================================================

if (supportBot) {

  // Player starts support
  supportBot.onText(/\/start/, async (msg) => {
    await supportBot.sendMessage(
      msg.chat.id,
      '👋 Welcome to እድል Bingo Support.\n\nSend your question here. Only the support admin can see your messages.'
    );
  });

  // Handle all support messages
  supportBot.on('message', async (msg) => {
    try {
      if (!msg.chat || !msg.from) return;

      const playerId = String(msg.from.id);

      // Admin replying to a player's message
      if (playerId === String(ADMIN_ID)) {

        if (!msg.reply_to_message) return;

        const adminMessageId = String(
          msg.reply_to_message.message_id
        );

        const snapshot = await db
          .ref(`supportMessages/${adminMessageId}`)
          .once('value');

        const ticket = snapshot.val();

        if (!ticket || !ticket.playerId) return;

        await supportBot.copyMessage(
          ticket.playerId,
          msg.chat.id,
          msg.message_id
        );

        return;
      }

      // Ignore commands other than /start
      if (msg.text && msg.text.startsWith('/')) return;

      // Forward player's message privately to admin
      const forwarded = await supportBot.forwardMessage(
        ADMIN_ID,
        msg.chat.id,
        msg.message_id
      );

      // Save connection between admin message and player
      await db.ref(`supportMessages/${forwarded.message_id}`).set({
        playerId,
        username: msg.from.username || '',
        firstName: msg.from.first_name || '',
        createdAt: Date.now()
      });

      await supportBot.sendMessage(
        msg.chat.id,
        '✅ Your message has been sent to support. We will reply here.'
      );

    } catch (error) {
      console.error('❌ Support bot error:', error);
    }
  });

  console.log('✅ Private Support Bot started');
}

module.exports = { bot, processGatewaySMS };