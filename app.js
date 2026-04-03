// app.js - Main orchestration module
import { WebAuthnAuth } from './lib/auth.js';
import { P2PNetwork } from './lib/p2p.js';
import { SocialDatabase } from './lib/database.js';
import { SocialGraph } from './lib/social.js';

class P2PSocialNetwork {
    constructor() {
        this.auth = null;
        this.p2p = null;
        this.db = null;
        this.social = null;
        this.currentUser = null;
        this.isInitialized = false;
        
        this.init();
    }
    
    async init() {
        try {
            this.showStatus('Initializing P2P network...', 'auth-status');
            
            // Initialize authentication first
            this.auth = new WebAuthnAuth();
            
            // Initialize database with OPFS persistence
            this.db = new SocialDatabase();
            await this.db.initialize();
            
            // Setup UI event listeners
            this.setupEventListeners();
            
            // Check if user has existing credentials
            const savedSession = localStorage.getItem('p2p_social_session');
            if (savedSession) {
                const session = JSON.parse(savedSession);
                await this.authenticateSession(session.userId);
            }
            
            this.showStatus('Ready', 'auth-status');
        } catch (error) {
            console.error('Initialization failed:', error);
            this.showStatus('Failed to initialize: ' + error.message, 'auth-status', true);
        }
    }
    
    async authenticateSession(userId) {
        try {
            // Attempt to restore session from database
            const user = await this.db.getUser(userId);
            if (user) {
                await this.completeAuthentication(user);
            }
        } catch (error) {
            console.error('Session restore failed:', error);
            localStorage.removeItem('p2p_social_session');
        }
    }
    
    async registerNewUser() {
        try {
            this.showStatus('Creating new passkey...', 'auth-status');
            
            const registration = await this.auth.register({
                username: `user_${Date.now()}`,
                displayName: `Social User ${Math.floor(Math.random() * 1000)}`
            });
            
            if (registration.success) {
                // Create user profile in local database
                const userProfile = {
                    id: registration.userId,
                    username: registration.username,
                    displayName: registration.displayName,
                    publicKey: registration.credentialId,
                    createdAt: new Date().toISOString(),
                    avatar: this.generateAvatar(registration.username)
                };
                
                await this.db.createUser(userProfile);
                await this.completeAuthentication(userProfile);
            } else {
                throw new Error('Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showStatus('Registration failed: ' + error.message, 'auth-status', true);
        }
    }
    
    async loginWithPasskey() {
        try {
            this.showStatus('Authenticating with passkey...', 'auth-status');
            
            const authentication = await this.auth.authenticate();
            
            if (authentication.success) {
                const user = await this.db.getUserByCredential(authentication.credentialId);
                if (user) {
                    await this.completeAuthentication(user);
                } else {
                    throw new Error('User not found');
                }
            } else {
                throw new Error('Authentication failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showStatus('Login failed: ' + error.message, 'auth-status', true);
        }
    }
    
    async completeAuthentication(user) {
        this.currentUser = user;
        
        // Initialize P2P network
        this.p2p = new P2PNetwork(this.currentUser.id);
        await this.p2p.initialize();
        
        // Initialize social graph
        this.social = new SocialGraph(this.p2p, this.db, this.currentUser);
        
        // Setup P2P event handlers
        this.setupP2PEventHandlers();
        
        // Save session
        localStorage.setItem('p2p_social_session', JSON.stringify({
            userId: this.currentUser.id,
            timestamp: Date.now()
        }));
        
        // Switch to main app view
        this.showApp();
        
        // Start peer discovery
        await this.p2p.startDiscovery();
        
        // Sync with network
        await this.social.syncWithNetwork();
    }
    
    setupP2PEventHandlers() {
        if (!this.p2p) return;
        
        this.p2p.onPeerConnect((peerId, peerInfo) => {
            this.updatePeersList();
            this.addSystemMessage(`${peerInfo.name || peerId} joined the network`);
        });
        
        this.p2p.onPeerDisconnect((peerId) => {
            this.updatePeersList();
            this.addSystemMessage(`Peer disconnected`);
        });
        
        this.p2p.onMessage(async (data, fromPeerId) => {
            await this.handleIncomingMessage(data, fromPeerId);
        });
        
        this.p2p.onPost(async (post, fromPeerId) => {
            await this.handleIncomingPost(post, fromPeerId);
        });
    }
    
    async handleIncomingMessage(data, fromPeerId) {
        const message = {
            id: crypto.randomUUID(),
            from: fromPeerId,
            content: data.content,
            timestamp: data.timestamp,
            type: 'direct'
        };
        
        await this.db.saveMessage(message);
        this.displayChatMessage(message);
    }
    
    async handleIncomingPost(post, fromPeerId) {
        const feedPost = {
            id: post.id,
            authorId: fromPeerId,
            content: post.content,
            timestamp: post.timestamp,
            likes: post.likes || 0
        };
        
        await this.db.savePost(feedPost);
        this.displayPost(feedPost);
    }
    
    async createPost(content) {
        if (!content.trim()) return;
        
        const post = {
            id: crypto.randomUUID(),
            authorId: this.currentUser.id,
            content: content.trim(),
            timestamp: Date.now(),
            likes: 0
        };
        
        // Save locally
        await this.db.savePost(post);
        this.displayPost(post);
        
        // Broadcast to network
        await this.p2p.broadcastPost(post);
        
        // Clear input
        document.getElementById('post-content').value = '';
        this.updateCharCount();
    }
    
    async sendDirectMessage(peerId, content) {
        if (!content.trim() || !peerId) return;
        
        const message = {
            content: content.trim(),
            timestamp: Date.now()
        };
        
        // Send via P2P
        await this.p2p.sendMessage(peerId, message);
        
        // Save locally
        const savedMessage = {
            id: crypto.randomUUID(),
            from: this.currentUser.id,
            to: peerId,
            content: message.content,
            timestamp: message.timestamp
        };
        
        await this.db.saveMessage(savedMessage);
        this.displayChatMessage(savedMessage, true);
        
        // Clear input
        document.getElementById('chat-input').value = '';
    }
    
    updatePeersList() {
        const peers = this.p2p.getConnectedPeers();
        const peersListEl = document.getElementById('peers-list');
        const chatSelectEl = document.getElementById('chat-peer-select');
        
        if (peers.length === 0) {
            peersListEl.innerHTML = '<div class="placeholder">No peers connected</div>';
            return;
        }
        
        // Update sidebar
        peersListEl.innerHTML = peers.map(peer => `
            <div class="peer-item" data-peer-id="${peer.id}">
                <div class="peer-avatar">${peer.avatar || '👤'}</div>
                <div class="peer-info">
                    <div class="peer-name">${peer.name || peer.id.slice(0, 8)}</div>
                    <div class="peer-status online">Online</div>
                </div>
            </div>
        `).join('');
        
        // Update chat selector
        chatSelectEl.innerHTML = '<option value="">Select a peer...</option>' + 
            peers.map(peer => `<option value="${peer.id}">${peer.name || peer.id.slice(0, 8)}</option>`).join('');
    }
    
    displayPost(post) {
        const feedEl = document.getElementById('feed');
        const postEl = document.createElement('div');
        postEl.className = 'post';
        postEl.dataset.postId = post.id;
        
        postEl.innerHTML = `
            <div class="post-header">
                <div class="post-author">${post.authorId === this.currentUser?.id ? 'You' : post.authorId.slice(0, 8)}</div>
                <div class="post-time">${new Date(post.timestamp).toLocaleTimeString()}</div>
            </div>
            <div class="post-content">${this.escapeHtml(post.content)}</div>
            <div class="post-actions">
                <button class="like-btn" data-post-id="${post.id}">❤️ ${post.likes}</button>
                <button class="reply-btn">💬 Reply</button>
            </div>
        `;
        
        feedEl.insertBefore(postEl, feedEl.firstChild);
        
        // Keep only last 100 posts
        while (feedEl.children.length > 100) {
            feedEl.removeChild(feedEl.lastChild);
        }
    }
    
    displayChatMessage(message, isOutgoing = false) {
        const chatMessagesEl = document.getElementById('chat-messages');
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isOutgoing ? 'outgoing' : 'incoming'}`;
        
        messageEl.innerHTML = `
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
        `;
        
        chatMessagesEl.appendChild(messageEl);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
    
    addSystemMessage(message) {
        const chatMessagesEl = document.getElementById('chat-messages');
        const systemEl = document.createElement('div');
        systemEl.className = 'system-message';
        systemEl.textContent = message;
        chatMessagesEl.appendChild(systemEl);
    }
    
    setupEventListeners() {
        // Auth buttons
        document.getElementById('register-passkey-btn')?.addEventListener('click', () => this.registerNewUser());
        document.getElementById('login-passkey-btn')?.addEventListener('click', () => this.loginWithPasskey());
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        
        // Post creation
        const postContent = document.getElementById('post-content');
        const postBtn = document.getElementById('post-btn');
        const charCount = document.getElementById('char-count');
        
        postContent?.addEventListener('input', () => this.updateCharCount());
        postBtn?.addEventListener('click', () => this.createPost(postContent.value));
        
        // Chat
        const chatInput = document.getElementById('chat-input');
        const chatSendBtn = document.getElementById('chat-send-btn');
        const chatPeerSelect = document.getElementById('chat-peer-select');
        
        chatPeerSelect?.addEventListener('change', (e) => {
            const isSelected = e.target.value;
            chatInput.disabled = !isSelected;
            chatSendBtn.disabled = !isSelected;
            
            if (isSelected) {
                this.loadChatHistory(e.target.value);
            }
        });
        
        chatSendBtn?.addEventListener('click', () => {
            const peerId = chatPeerSelect.value;
            const message = chatInput.value;
            this.sendDirectMessage(peerId, message);
        });
        
        chatInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatSendBtn?.click();
            }
        });
    }
    
    async loadChatHistory(peerId) {
        const messages = await this.db.getMessagesBetween(this.currentUser.id, peerId);
        const chatMessagesEl = document.getElementById('chat-messages');
        chatMessagesEl.innerHTML = '';
        
        messages.forEach(msg => {
            this.displayChatMessage(msg, msg.from === this.currentUser.id);
        });
    }
    
    updateCharCount() {
        const postContent = document.getElementById('post-content');
        const charCount = document.getElementById('char-count');
        if (postContent && charCount) {
            charCount.textContent = `${postContent.value.length}/500`;
        }
    }
    
    showStatus(message, elementId, isError = false) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.className = `status ${isError ? 'error' : 'info'}`;
        }
    }
    
    showApp() {
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');
        document.getElementById('peer-status').textContent = 'Connected';
        document.getElementById('username').textContent = this.currentUser?.displayName || this.currentUser?.username;
    }
    
    async logout() {
        if (this.p2p) {
            await this.p2p.disconnect();
        }
        
        localStorage.removeItem('p2p_social_session');
        this.currentUser = null;
        this.isInitialized = false;
        
        document.getElementById('app-screen').classList.remove('active');
        document.getElementById('auth-screen').classList.add('active');
    }
    
    generateAvatar(username) {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
        const index = username.length % colors.length;
        return colors[index];
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the application
window.addEventListener('DOMContentLoaded', () => {
    window.app = new P2PSocialNetwork();
});