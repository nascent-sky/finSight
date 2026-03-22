import { initializeApp } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyDdb1-1F5Vtd9KAaxO3JrmS-Nr9GwWaS8M",
  authDomain: "finsight-web.firebaseapp.com",
  projectId: "finsight-web",
  storageBucket: "finsight-web.firebasestorage.app",
  messagingSenderId: "792812376072",
  appId: "1:792812376072:web:279393f403e32be95281bd",
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const provider = new GoogleAuthProvider()

let db

try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  })
} catch (error) {
  console.warn("Firestore persistence fallback enabled.", error)
  db = getFirestore(app)
}

export { db }
