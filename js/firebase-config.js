// Paste the config object from your Firebase project here.
// Firebase Console → Project Settings → General → Your apps → SDK setup and configuration
// This is safe to keep in client-side code — Firebase's security comes from
// Firestore Rules (see README), not from hiding this object.

const firebaseConfig = {
  apiKey: "AIzaSyDi7GIDVD0TP05fajIO2Ot4j8iaisUXjEo",
  authDomain: "fitpact-747ff.firebaseapp.com",
  projectId: "fitpact-747ff",
  storageBucket: "fitpact-747ff.firebasestorage.app",
  messagingSenderId: "714582986087",
  appId: "1:714582986087:web:a0e31ba6e0af63d4f3f3c2"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
