// Recovery copies use a separate browser database when localStorage is full.
// Never remove the source until the database transaction and read-back succeed.
(function(root) {
  async function database() {
    return new Promise((resolve,reject) => {
      const request = root.indexedDB.open('ninq-recovery-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('copies',{keyPath:'key'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('復旧用データベースを開けません。別のNINQ画面を閉じてください。'));
    });
  }
  async function transact(mode, operation) {
    const db = await database();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction('copies',mode);
        let result;
        const request = operation(tx.objectStore('copies'));
        request.onsuccess = () => { result=request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || new Error('復旧用コピーの保存が中断されました'));
        tx.onerror = () => reject(tx.error || new Error('復旧用コピーの保存に失敗しました'));
      });
    } finally { db.close(); }
  }
  root.NinqRecoveryStore = {
    async archive(key,raw,owner) {
      await transact('readwrite',store=>store.put({key,raw,owner}));
      const copy = await transact('readonly',store=>store.get(key));
      if (!copy || copy.raw !== raw || copy.owner !== owner) throw new Error('移動先の復旧用コピーを確認できませんでした');
    },
    async list(owner) { return (await transact('readonly',store=>store.getAll())).filter(copy=>copy.owner===owner); },
    async read(key,owner) {
      const copy=await transact('readonly',store=>store.get(key));
      if (!copy || copy.owner!==owner) throw new Error('復旧用コピーが見つかりません');
      return copy.raw;
    }
  };
})(globalThis);
