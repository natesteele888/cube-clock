// ---------------------------------------------------------------------------
// Firebase config for Cube Clock. These values are NOT secrets -- a Firebase web
// config is designed to ship in the browser. What protects the data is
// firestore.rules, not hiding this file.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyBd8KganSzt1OqXOevEm98dMXyOt-X39HQ",
  authDomain: "cube-clock-49011.firebaseapp.com",
  projectId: "cube-clock-49011",
  storageBucket: "cube-clock-49011.firebasestorage.app",
  messagingSenderId: "310432977569",
  appId: "1:310432977569:web:c476581c074e3d7b1416e0"
};

export const configured = !Object.values(firebaseConfig)
  .some(v => typeof v === "string" && (v.startsWith("PASTE_") || v === ""));
