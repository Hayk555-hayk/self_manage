import { auth } from "./firebase-config.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

export async function register(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function observeAuthState(callback) {
  onAuthStateChanged(auth, callback);
}
