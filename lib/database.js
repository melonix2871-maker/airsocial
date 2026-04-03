// lib/database.js - GenosDB with OPFS persistence
export class SocialDatabase {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.stores = {
            users: null,
            posts: null,
            messages: null,
            follows: null
        };
    }
    
    async initialize() {
        try {
            // Check if GenosDB is available
            if (typeof GDB === 'undefined') {
                console.warn('GenosDB not loaded, using IndexedDB fallback');
                return this.initializeIndexedDB();
            }
            
            // Initialize GenosDB with OPFS storage
            this.db = new GDB({
                name: 'p2p_social_db',
                version: 1,
                storage: 'opfs', // Origin Private File System for persistence
                sync: {
                    enabled: true,
                    p2p: true
                }
            });
            
            await this.db.open();
            
            // Create stores/nodes
            await this.db.createGraph('users', {
                indexes: ['username', 'publicKey', 'createdAt']
            });
            
            await this.db.createGraph('posts', {
                indexes: ['authorId', 'timestamp', 'likes']
            });
            
            await this.db.createGraph('messages', {
                indexes: ['from', 'to', 'timestamp']
            });
            
            await this.db.createGraph('follows', {
                indexes: ['followerId', 'followingId']
            });
            
            this.isInitialized = true;
            console.log('GenosDB initialized with OPFS persistence');
            
        } catch (error) {
            console.error('GenosDB initialization failed, falling back to IndexedDB:', error);
            return this.initializeIndexedDB();
        }
    }
    
    async initializeIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('p2p_social_db', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object stores
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'id' });
                    userStore.createIndex('username', 'username', { unique: true });
                    userStore.createIndex('publicKey', 'publicKey', { unique: true });
                    userStore.createIndex('createdAt', 'createdAt');
                }
                
                if (!db.objectStoreNames.contains('posts')) {
                    const postStore = db.createObjectStore('posts', { keyPath: 'id' });
                    postStore.createIndex('authorId', 'authorId');
                    postStore.createIndex('timestamp', 'timestamp');
                }
                
                if (!db.objectStoreNames.contains('messages')) {
                    const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
                    messageStore.createIndex('from', 'from');
                    messageStore.createIndex('to', 'to');
                    messageStore.createIndex('timestamp', 'timestamp');
                    messageStore.createIndex('conversation', ['from', 'to']);
                }
                
                if (!db.objectStoreNames.contains('follows')) {
                    const followStore = db.createObjectStore('follows', { keyPath: 'id' });
                    followStore.createIndex('followerId', 'followerId');
                    followStore.createIndex('followingId', 'followingId');
                }
            };
        });
    }
    
    async createUser(user) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.add === 'function') {
            // GenosDB mode
            await this.db.add('users', user);
        } else {
            // IndexedDB mode
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['users'], 'readwrite');
                const store = transaction.objectStore('users');
                const request = store.add(user);
                request.onsuccess = () => resolve(user);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async getUser(userId) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.get === 'function') {
            return await this.db.get('users', userId);
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['users'], 'readonly');
                const store = transaction.objectStore('users');
                const request = store.get(userId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async getUserByCredential(credentialId) {
        if (!this.isInitialized) await this.initialize();
        
        // Find user by publicKey (credentialId)
        if (this.db && typeof this.db.query === 'function') {
            const results = await this.db.query('users', { publicKey: credentialId });
            return results[0] || null;
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['users'], 'readonly');
                const store = transaction.objectStore('users');
                const index = store.index('publicKey');
                const request = index.get(credentialId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async savePost(post) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.add === 'function') {
            await this.db.add('posts', post);
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['posts'], 'readwrite');
                const store = transaction.objectStore('posts');
                const request = store.add(post);
                request.onsuccess = () => resolve(post);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async getPosts(limit = 50, before = null) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.query === 'function') {
            const query = { limit };
            if (before) query.timestamp = { $lt: before };
            const results = await this.db.query('posts', query, { sort: { timestamp: -1 } });
            return results;
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['posts'], 'readonly');
                const store = transaction.objectStore('posts');
                const index = store.index('timestamp');
                const request = index.openCursor(null, 'prev');
                
                const posts = [];
                let count = 0;
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor && count < limit) {
                        posts.push(cursor.value);
                        count++;
                        cursor.continue();
                    } else {
                        resolve(posts);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async saveMessage(message) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.add === 'function') {
            await this.db.add('messages', message);
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['messages'], 'readwrite');
                const store = transaction.objectStore('messages');
                const request = store.add(message);
                request.onsuccess = () => resolve(message);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async getMessagesBetween(userA, userB, limit = 50) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.query === 'function') {
            const results = await this.db.query('messages', {
                $or: [
                    { from: userA, to: userB },
                    { from: userB, to: userA }
                ]
            }, { sort: { timestamp: 1 }, limit });
            return results;
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['messages'], 'readonly');
                const store = transaction.objectStore('messages');
                const index = store.index('timestamp');
                const request = index.openCursor(null, 'next');
                
                const messages = [];
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const msg = cursor.value;
                        if ((msg.from === userA && msg.to === userB) || 
                            (msg.from === userB && msg.to === userA)) {
                            messages.push(msg);
                        }
                        cursor.continue();
                    } else {
                        // Return last 'limit' messages
                        resolve(messages.slice(-limit));
                    }
                };
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async follow(followerId, followingId) {
        if (!this.isInitialized) await this.initialize();
        
        const follow = {
            id: `${followerId}_${followingId}`,
            followerId,
            followingId,
            createdAt: Date.now()
        };
        
        if (this.db && typeof this.db.add === 'function') {
            await this.db.add('follows', follow);
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['follows'], 'readwrite');
                const store = transaction.objectStore('follows');
                const request = store.add(follow);
                request.onsuccess = () => resolve(follow);
                request.onerror = () => reject(request.error);
            });
        }
    }
    
    async getFollowers(userId) {
        if (!this.isInitialized) await this.initialize();
        
        if (this.db && typeof this.db.query === 'function') {
            return await this.db.query('follows', { followingId: userId });
        } else {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['follows'], 'readonly');
                const store = transaction.objectStore('follows');
                const index = store.index('followingId');
                const request = index.getAll(userId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
    }
}