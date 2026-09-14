// firebase-client.js — Firebase client config + real‑time helpers

// 🔑 REPLACE with your own Firebase config (or leave as is for now)
// These values are placeholders — you can update them later when you have a Firebase project.
// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCMfDNAWQtrJGijQLUC5KQWi5hVTgEvJTo",
  authDomain: "zabingo-d2ed5.firebaseapp.com",
  databaseURL: "https://zabingo-d2ed5-default-rtdb.firebaseio.com/",
  projectId: "zabingo-d2ed5",
  storageBucket: "zabingo-d2ed5.firebasestorage.app",
  messagingSenderId: "75991744418",
  appId: "1:75991744418:web:70afa1b06418ddc50ffcfb",
  measurementId: "G-PJD0H9SY9Z"
};

// Firebase SDKs are loaded via CDN in index.html
let db = null;
let isFirebaseReady = false;

// Try to initialize Firebase
try {
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    isFirebaseReady = true;
    console.log('✅ Firebase initialized successfully');
  } else {
    console.warn('⚠️ Firebase SDK not loaded — running in mock mode');
  }
} catch (e) {
  console.warn('⚠️ Firebase init failed:', e.message);
}

// ----- Firebase Client API -----
const FirebaseClient = {
  isReady: isFirebaseReady,
  db: db,

  // Listen to a room's data (real‑time)
  listenRoom(roomId, callback) {
    if (!isFirebaseReady) {
      // Mock mode: return a fake listener that never updates
      console.log('📡 Mock: listening to room', roomId);
      return { mock: true, roomId };
    }
    const ref = db.ref(`rooms/${roomId}`);
    ref.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) callback(data);
    });
    return ref; // return ref so you can detach later
  },

  // Listen to player's balance
  listenBalance(userId, callback) {
    if (!isFirebaseReady) {
      console.log('📡 Mock: listening to balance for', userId);
      return { mock: true, userId };
    }
    const ref = db.ref(`players/${userId}/balance`);
    ref.on('value', (snapshot) => {
      const balance = snapshot.val() || 0;
      callback(balance);
    });
    return ref;
  },

  // Listen to a specific cartela's numbers
  listenCartela(cartelaId, callback) {
    if (!isFirebaseReady) {
      console.log('📡 Mock: listening to cartela', cartelaId);
      return { mock: true, cartelaId };
    }
    const ref = db.ref(`cartelas/${cartelaId}/numbers`);
    ref.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) callback(data);
    });
    return ref;
  },

  // Detach a listener
  detach(ref) {
    if (ref && ref.off) {
      ref.off();
    } else if (ref && ref.mock) {
      console.log('📡 Mock: detached listener');
    }
  },

  // Write data to Firebase (for admin/backend use, not typically from frontend)
  // This is included for completeness, but in a secure app you'd use the backend API.
  setData(path, value) {
    if (!isFirebaseReady) {
      console.warn('⚠️ Firebase not ready, cannot write', path, value);
      return Promise.reject('Firebase not ready');
    }
    return db.ref(path).set(value);
  },

  // Get data once (for one‑time reads)
  getData(path) {
    if (!isFirebaseReady) {
      console.warn('⚠️ Firebase not ready, cannot read', path);
      return Promise.reject('Firebase not ready');
    }
    return db.ref(path).once('value').then(snap => snap.val());
  }
};

// Make globally available
window.FirebaseClient = FirebaseClient;