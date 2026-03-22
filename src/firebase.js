// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // 👈 ADD THIS

const firebaseConfig = {
  apiKey: "AIzaSyDdb1-1F5Vtd9KAaxO3JrmS-Nr9GwWaS8M",
  authDomain: "finsight-web.firebaseapp.com",
  projectId: "finsight-web",
  storageBucket: "finsight-web.firebasestorage.app",
  messagingSenderId: "792812376072",
  appId: "1:792812376072:web:279393f403e32be95281bd"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// ✅ ADD THIS
export const db = getFirestore(app);