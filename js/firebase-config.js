// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyADUgMohHRNsJV_87TPGKa1jIGEiEnVqIE",
  authDomain: "self-878d4.firebaseapp.com",
  projectId: "self-878d4",
  storageBucket: "self-878d4.appspot.com",
  messagingSenderId: "1024241131346",
  appId: "1:1024241131346:web:95b7acd019abe13e10e48b",
  measurementId: "G-83W7R4FGRR"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export {firebaseConfig, auth, analytics, db};