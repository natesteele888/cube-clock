// ---------------------------------------------------------------------------
// Paste your Firebase web-app config here. SETUP.md walks through getting it.
//
// These values are NOT secrets. A Firebase web config is meant to ship in the
// browser; what protects your data is firestore.rules, not hiding this object.
//
// Until you fill this in, the app still runs perfectly as a local timer --
// the leaderboard simply reports itself as offline.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT.firebaseapp.com",
  projectId: "PASTE_PROJECT",
  storageBucket: "PASTE_PROJECT.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// Flipped to false automatically when the config above is still the placeholder.
export const configured = !Object.values(firebaseConfig)
  .some(v => typeof v === "string" && v.startsWith("PASTE_"));
