// telegram.js — Telegram WebApp SDK wrapper

const TelegramApp = (() => {
  let tg = null;

  function init() {
    if (typeof Telegram !== 'undefined' && Telegram.WebApp) {
      tg = Telegram.WebApp;
      tg.expand();
      tg.ready();
      return true;
    }
    console.warn('Telegram WebApp SDK not found — running in browser mode.');
    return false;
  }

  function getUser() {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      return tg.initDataUnsafe.user;
    }
    // Fallback for local testing
    return {
      id: 123456789,
      first_name: 'Test',
      username: 'test_user',
    };
  }

  function getTheme() {
    if (tg && tg.themeParams) {
      return tg.themeParams;
    }
    return {
      bg_color: '#0f0f1a',
      text_color: '#f0f0f5',
      hint_color: '#a0a0b8',
      button_color: '#f7931e',
    };
  }

  function closeApp() {
    if (tg) tg.close();
  }

  function showAlert(msg) {
    if (tg) tg.showAlert(msg);
    else alert(msg);
  }

  function showConfirm(msg, callback) {
    if (tg) tg.showConfirm(msg, callback);
    else {
      const ok = confirm(msg);
      callback(ok);
    }
  }

  return {
    init,
    getUser,
    getTheme,
    closeApp,
    showAlert,
    showConfirm,
  };
})();