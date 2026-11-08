// Firebase SDK Modular Import (13.1.0)
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBThlQIGL03dD39_ERpTM311tGiqSHCwoo",
  authDomain: "syncverse-ab06a.firebaseapp.com",
  projectId: "syncverse-ab06a",
  storageBucket: "syncverse-ab06a.firebasestorage.app",
  messagingSenderId: "1013919046104",
  appId: "1:1013919046104:web:d8e7d28a66e9840b0e3aad"
};

// Initialize App
export const app = initializeApp(firebaseConfig);

// Initialize Firestore with Offline Persistence enabled for supermarket offline mode
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  console.warn("Falling back to default getFirestore instance:", err);
  dbInstance = getFirestore(app);
}

export const db = dbInstance;
