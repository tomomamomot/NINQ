import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAVuH9TB_ngfUSlte_KxVvj0A1-hTzjOc',
  authDomain: 'ninq-6de8a.firebaseapp.com',
  projectId: 'ninq-6de8a',
  storageBucket: 'ninq-6de8a.firebasestorage.app',
  messagingSenderId: '549724532746',
  appId: '1:549724532746:web:e6809ee98fb74713ba6ff3',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
} catch (error) {
  db = getFirestore(app);
}
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

let currentUser = null;

function publicUser(user) {
  return user ? {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
  } : null;
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function stateRef(user = currentUser) {
  if (!user) throw new Error('NINQクラウドにログインしてください');
  return doc(db, 'users', user.uid, 'state', 'main');
}

async function signIn() {
  try {
    const result = await signInWithPopup(auth, provider);
    return publicUser(result.user);
  } catch (error) {
    if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

async function readState() {
  const snapshot = await getDoc(stateRef());
  if (!snapshot.exists()) return null;
  return snapshot.data()?.payload || null;
}

async function writeState(payload) {
  await setDoc(stateRef(), {
    payload,
    modifiedAt: payload?.modifiedAt || '',
    syncedAt: new Date().toISOString(),
    appVersion: payload?.appVersion || '',
    updatedAt: serverTimestamp(),
  });
}

window.NinqFirebaseCloud = {
  signIn,
  signOut: () => signOut(auth),
  currentUser: () => publicUser(currentUser),
  readState,
  writeState,
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  emit('ninq-firebase-auth', { user: publicUser(user) });
});

getRedirectResult(auth).catch((error) => {
  emit('ninq-firebase-error', { message: error.message || 'Firebaseログインに失敗しました' });
});

emit('ninq-firebase-ready');
