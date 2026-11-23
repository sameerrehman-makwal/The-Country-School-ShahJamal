/**
 * Firebase Configuration & Initialization
 * The Country School ShahJamal Attendance System
 * 
 * Powered by Firebase v10 Modular SDK (via official Google CDN)
 * Configured with IndexedDB Offline Persistence for complete offline resilience.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/**
 * ---------------------------------------------------------------------
 * STEP 1: ADD YOUR FIREBASE CONFIG KEYS HERE
 * ---------------------------------------------------------------------
 * 1. Open Firebase Console: https://console.firebase.google.com/
 * 2. Select or create your project: "The Country School ShahJamal"
 * 3. Go to Project Settings (gear icon) -> "General" -> Scroll down to "Your apps".
 * 4. Click the Web (</>) icon to register a web app.
 * 5. Copy the configuration object and paste it below:
 */
export const firebaseConfig = {
  apiKey: "AIzaSyDrlk9x80OoZwMA96ZiJ8gywcP3uXnbEdY",
  authDomain: "country-school-shahjamal.firebaseapp.com",
  projectId: "country-school-shahjamal",
  storageBucket: "country-school-shahjamal.firebasestorage.app",
  messagingSenderId: "735993190409",
  appId: "1:735993190409:web:5309ee85e27511f0d800d8",
  measurementId: "G-NNY67S5DJX"
};

/**
 * Checks whether the configuration contains valid Firebase credentials
 * rather than unedited template placeholders.
 */
export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('REPLACE_WITH') &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes('YOUR_PROJECT')
  );
}

// Initialize the core Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication with explicit localStorage persistence
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn('Auth persistence initialization notice:', err);
});

// Initialize Cloud Firestore with Offline IndexedDB Cache (Multi-tab support)
let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
  console.log('✅ Firestore offline persistence (IndexedDB) enabled successfully.');
} catch (error) {
  console.warn('Firestore offline persistence fallback triggered:', error);
  // Fallback to standard initialization if IndexedDB is blocked (e.g. strict private browsing)
  firestoreInstance = initializeFirestore(app, {});
}

export const db = firestoreInstance;

/**
 * Online / Offline State Tracker
 * Allows the SPA UI to show teachers real-time connection status.
 */
export function initNetworkMonitor(onStatusChange) {
  const updateStatus = () => {
    const isOnline = navigator.onLine;
    if (typeof onStatusChange === 'function') {
      onStatusChange(isOnline);
    }
  };

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus(); // Initial check
}
