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
  appId: "1:714582986087:web:a0e31ba6e0af63d4f3f3c2
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// For real push notifications (see README "Push notifications" section):
// 1. Firebase Console → Project Settings → Cloud Messaging → Web configuration
//    → Generate key pair. Paste that key below.
// 2. Requires the Blaze (pay-as-you-go) plan to deploy the Cloud Functions
//    that actually send the pushes — see README for details and cost notes.
const VAPID_KEY = "BCDtM2w5lpIhxhBKN0ZVm6vcYwVGLDZ8qfs-OPAKP6f00sCdXQUIs9zIkWHkR4Lo3B2ssyPai0Nyp58LHoWxE6Y";
let messaging = null;
(function initMessagingSupport() {
  try {
    const supported = firebase.messaging.isSupported();
    if (supported && typeof supported.then === 'function') {
      supported.then(ok => { if (ok) messaging = firebase.messaging(); });
    } else if (supported) {
      messaging = firebase.messaging();
    }
  } catch (e) { messaging = null; }
})();
