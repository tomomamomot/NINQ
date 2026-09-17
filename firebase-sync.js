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
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAVuH9TB_ngfUSlte_KxVvj001I-hTzjOc',
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

function stateRef(uid) {
  if (!uid || currentUser?.uid !== uid) throw new Error('ログイン状態が変わりました');
  return doc(db, 'users', uid, 'state', 'main');
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

async function readState({uid} = {}) {
  const snapshot = await getDoc(stateRef(uid));
  if (currentUser?.uid !== uid) throw new Error('ログイン状態が変わりました');
  if (!snapshot.exists()) return null;
  return snapshot.data()?.payload || null;
}

async function syncState(payload, {uid, expectedGeneration, merge}) {
  const ref = stateRef(uid);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (currentUser?.uid !== uid) throw new Error('ログイン状態が変わりました');
    const remote = snapshot.exists() ? snapshot.data().payload : null;
    if (remote) window.NinqData.validateBackup(remote);
    const remoteGeneration = remote?.state?.restoreGeneration || 'initial';
    const restore = payload.state.pendingRestore;
    if (remote && remoteGeneration !== expectedGeneration && remoteGeneration !== payload.state.restoreGeneration) return {conflict:true, payload:remote};
    if (remote?.version > 3) throw new Error('アプリを更新してください');
    const next = JSON.parse(JSON.stringify(payload));
    if (remote && !(restore && remoteGeneration === restore.base)) next.state = merge(payload.state, remote.state || remote);
    next.state.pendingRestore = null;
    if (remote && JSON.stringify(next.state) === JSON.stringify(remote.state)) return {conflict:false,payload:remote,generation:remoteGeneration};
    next.generation = next.state.restoreGeneration || 'initial';
    next.revision = (snapshot.data()?.revision || 0) + 1;
    // Conservative guard: the server remains the authority for the exact encoded size.
    if (new TextEncoder().encode(JSON.stringify(next)).length > 800000) throw new Error('クラウド保存容量に近づいています。データを書き出し、保存構造の更新が必要です');
    transaction.set(ref, {payload:next, revision:next.revision, modifiedAt:next.modifiedAt || '',
      appVersion:next.appVersion || '', syncedAt:new Date().toISOString(), updatedAt:serverTimestamp()});
    return {conflict:false, payload:next, generation:next.generation};
  });
}

window.NinqFirebaseCloud = {
  signIn,
  signOut: () => signOut(auth),
  currentUser: () => publicUser(currentUser),
  readState,
  syncState,
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  emit('ninq-firebase-auth', { user: publicUser(user) });
});

getRedirectResult(auth).catch((error) => {
  emit('ninq-firebase-error', { message: error.message || 'Firebaseログインに失敗しました' });
});

emit('ninq-firebase-ready');
