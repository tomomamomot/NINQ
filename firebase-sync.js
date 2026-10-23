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
let authResolved = false;

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
  const ref=stateRef(uid);
  return runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(ref);
    const result=await readCloudPayload(transaction,uid,snapshot.exists()?snapshot.data():null);
    if(currentUser?.uid!==uid) throw new Error('ログイン状態が変わりました');
    return result;
  });
}

function partRef(uid,index) { return doc(db,'users',uid,'state',`part-${String(index).padStart(4,'0')}`); }
async function readCloudPayload(transaction,uid,main) {
  if(!main) return null;
  if(!main.storageVersion) return main.payload || null;
  const count=window.NinqCloudFormat.partCount(main);
  const snapshots=await Promise.all(Array.from({length:count},(_,i)=>transaction.get(partRef(uid,i))));
  return window.NinqCloudFormat.unpack(main,snapshots.map(snapshot=>snapshot.exists()?snapshot.data():null));
}
async function syncState(payload, {uid, expectedGeneration, merge}) {
  const ref = stateRef(uid);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (currentUser?.uid !== uid) throw new Error('ログイン状態が変わりました');
    const main=snapshot.exists()?snapshot.data():null;
    const remote = await readCloudPayload(transaction,uid,main);
    if (currentUser?.uid !== uid) throw new Error('ログイン状態が変わりました');
    if (remote) window.NinqData.validateBackup(remote, {skipEntryValues:true});
    window.NinqData.validateBackup(payload);
    const remoteGeneration = remote?.state?.restoreGeneration || 'initial';
    const restore = payload.state.pendingRestore;
    if (remote && remoteGeneration !== expectedGeneration && remoteGeneration !== payload.state.restoreGeneration) {
      window.NinqData.validateBackup(remote);
      return {conflict:true, payload:remote};
    }
    if (remote?.version > 3) throw new Error('アプリを更新してください');
    const next = JSON.parse(JSON.stringify(payload));
    if (remote && !(restore && remoteGeneration === restore.base)) {
      const remoteState = remote.state || remote;
      // Resolve edits/deletions before value validation, without normalizing away bad values.
      const deleted = window.NinqData.mergeMaps(payload.state.deletedEntryIds, remoteState.deletedEntryIds);
      const entries = window.NinqData.mergeItems(payload.state.entries, remoteState.entries, deleted);
      window.NinqData.validateBackup({...remote, state:{...remoteState, entries}});
      next.state = merge(payload.state, remoteState);
    }
    window.NinqData.validateBackup(next);
    next.state.pendingRestore = null;
    if (remote && JSON.stringify(next.state) === JSON.stringify(remote.state)) return {conflict:false,payload:remote,generation:remoteGeneration};
    next.generation = next.state.restoreGeneration || 'initial';
    next.revision = (snapshot.data()?.revision || 0) + 1;
    const encoded=window.NinqCloudFormat.pack(next,next.revision);
    // All reads precede writes; Firestore commits the manifest and every part atomically.
    // The original document is retained once, for recovery from the old format.
    if(main && !main.storageVersion) transaction.set(doc(db,'users',uid,'state','legacy-before-v4'),main);
    encoded.parts.forEach((part,index)=>transaction.set(partRef(uid,index),part));
    transaction.set(ref, {...encoded.manifest, modifiedAt:next.modifiedAt || '',
      appVersion:next.appVersion || '', syncedAt:new Date().toISOString(), updatedAt:serverTimestamp()});
    return {conflict:false, payload:next, generation:next.generation};
  });
}

window.NinqFirebaseCloud = {
  signIn,
  signOut: () => signOut(auth),
  currentUser: () => publicUser(currentUser),
  authResolved: () => authResolved,
  readState,
  syncState,
};

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authResolved = true;
  emit('ninq-firebase-auth', { user: publicUser(user) });
}, (error) => emit('ninq-firebase-error', {message:error.message || 'ログイン状態を確認できません'}));

getRedirectResult(auth).catch((error) => {
  emit('ninq-firebase-error', { message: error.message || 'Firebaseログインに失敗しました' });
});

emit('ninq-firebase-ready');
