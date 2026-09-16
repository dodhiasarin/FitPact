// This file must live at the ROOT of your deployed site (same folder as
// index.html), because a service worker's scope defaults to the folder it's
// served from and everything below it.

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

// Must match the config in js/firebase-config.js.
firebase.initializeApp({
  apiKey: "AIzaSyDi7GIDVD0TP05fajIO2Ot4j8iaisUXjEo",
  authDomain: "fitpact-747ff.firebaseapp.com",
  projectId: "fitpact-747ff",
  storageBucket: "fitpact-747ff.firebasestorage.app",
  messagingSenderId: "714582986087",
  appId: "1:714582986087:web:a0e31ba6e0af63d4f3f3c2
});

const messaging = firebase.messaging();

// Fires when a push arrives while the app is closed or in the background.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'FitPact';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, { body, icon: 'icons/icon-192.png' });
});
