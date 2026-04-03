// lib/p2p.js - WebRTC P2P mesh network using webconnect.js
export class P2PNetwork {
    constructor(userId) {
        this.userId = userId;
        this.webconnect = null;
        this.connectedPeers = new Map();
        this.eventHandlers = {
            onPeerConnect: [],
            onPeerDisconnect: [],
            onMessage: [],
            onPost: []
        };
        this.channelName = 'p2p_social_network';
        this.appName = 'P2PSocialNetwork';
    }
    
    async initialize() {
        return new Promise((resolve, reject) => {
            try {
                // Initialize webconnect with custom configuration
                this.webconnect = webconnect({
                    appName: this.appName,
                    channelName: this.channelName,
                    iceConfiguration: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                            { urls: 'stun:stun2.l.google.com:19302' }
                        ]
                    }
                });
                
                // Setup event listeners
                this.webconnect.onConnect(async (attribute) => {
                    await this.handlePeerConnect(attribute);
                });
                
                this.webconnect.onDisconnect((attribute) => {
                    this.handlePeerDisconnect(attribute);
                });
                
                this.webconnect.onReceive((data, attribute) => {
                    this.handleReceive(data, attribute);
                });
                
                // Get our connection ID
                this.webconnect.getMyId((attribute) => {
                    this.myId = attribute.connectId;
                    console.log('P2P Network initialized, ID:', this.myId);
                    resolve();
                });
            } catch (error) {
                console.error('Webconnect initialization failed:', error);
                reject(error);
            }
        });
    }
    
    async startDiscovery() {
        console.log('Starting peer discovery...');
        // webconnect automatically handles discovery via torrent trackers
        // Additional discovery mechanisms can be added here
        
        // Broadcast our presence
        setTimeout(() => {
            this.broadcastPresence();
        }, 1000);
    }
    
    async broadcastPresence() {
        const presence = {
            type: 'presence',
            userId: this.userId,
            timestamp: Date.now(),
            peerId: this.myId
        };
        
        if (this.webconnect) {
            this.webconnect.Send(presence, null);
        }
    }
    
    async handlePeerConnect(attribute) {
        const peerId = attribute.connectId;
        
        // Request peer info
        this.webconnect.Send({ type: 'get_info', userId: this.userId }, { connectId: peerId });
        
        this.connectedPeers.set(peerId, {
            id: peerId,
            userId: null,
            name: null,
            connectedAt: Date.now(),
            latency: null
        });
        
        // Measure latency
        const latency = await this.pingPeer(peerId);
        this.connectedPeers.get(peerId).latency = latency;
        
        // Trigger event handlers
        this.eventHandlers.onPeerConnect.forEach(handler => {
            handler(peerId, this.connectedPeers.get(peerId));
        });
    }
    
    handlePeerDisconnect(attribute) {
        const peerId = attribute.connectId;
        const peerInfo = this.connectedPeers.get(peerId);
        
        this.connectedPeers.delete(peerId);
        
        this.eventHandlers.onPeerDisconnect.forEach(handler => {
            handler(peerId, peerInfo);
        });
    }
    
    handleReceive(data, attribute) {
        const fromPeerId = attribute.connectId;
        
        // Handle different message types
        if (data.type === 'presence') {
            this.updatePeerInfo(fromPeerId, data);
        } else if (data.type === 'get_info') {
            this.sendPeerInfo(fromPeerId);
        } else if (data.type === 'peer_info') {
            this.updatePeerInfo(fromPeerId, data);
        } else if (data.type === 'post') {
            this.eventHandlers.onPost.forEach(handler => {
                handler(data.post, fromPeerId);
            });
        } else if (data.type === 'message') {
            this.eventHandlers.onMessage.forEach(handler => {
                handler(data.message, fromPeerId);
            });
        }
    }
    
    sendPeerInfo(targetPeerId) {
        const info = {
            type: 'peer_info',
            userId: this.userId,
            name: localStorage.getItem('p2p_username') || this.userId.slice(0, 8),
            timestamp: Date.now()
        };
        
        this.webconnect.Send(info, { connectId: targetPeerId });
    }
    
    updatePeerInfo(peerId, data) {
        const peer = this.connectedPeers.get(peerId);
        if (peer) {
            peer.userId = data.userId;
            peer.name = data.name;
            this.connectedPeers.set(peerId, peer);
        }
    }
    
    async broadcastPost(post) {
        const message = {
            type: 'post',
            post: post,
            timestamp: Date.now()
        };
        
        // Broadcast to all connected peers
        this.webconnect.Send(message, null);
    }
    
    async sendMessage(peerId, messageContent) {
        const message = {
            type: 'message',
            message: messageContent,
            timestamp: Date.now()
        };
        
        this.webconnect.Send(message, { connectId: peerId });
    }
    
    async pingPeer(peerId) {
        try {
            const latency = await this.webconnect.Ping({ connectId: peerId });
            return latency;
        } catch (error) {
            console.error('Ping failed:', error);
            return null;
        }
    }
    
    getConnectedPeers() {
        return Array.from(this.connectedPeers.values());
    }
    
    onPeerConnect(handler) {
        this.eventHandlers.onPeerConnect.push(handler);
    }
    
    onPeerDisconnect(handler) {
        this.eventHandlers.onPeerDisconnect.push(handler);
    }
    
    onMessage(handler) {
        this.eventHandlers.onMessage.push(handler);
    }
    
    onPost(handler) {
        this.eventHandlers.onPost.push(handler);
    }
    
    async disconnect() {
        if (this.webconnect) {
            this.webconnect.Disconnect();
        }
        this.connectedPeers.clear();
    }
}