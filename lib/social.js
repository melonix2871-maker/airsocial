// lib/social.js - Social graph operations
export class SocialGraph {
    constructor(p2pNetwork, database, currentUser) {
        this.p2p = p2pNetwork;
        this.db = database;
        this.currentUser = currentUser;
        this.following = new Set();
        this.feedCache = [];
    }
    
    async syncWithNetwork() {
        console.log('Syncing with network...');
        
        // Request latest posts from connected peers
        const peers = this.p2p.getConnectedPeers();
        for (const peer of peers) {
            await this.requestPeerPosts(peer.id);
        }
        
        // Load local feed
        await this.loadLocalFeed();
    }
    
    async requestPeerPosts(peerId) {
        const request = {
            type: 'sync_request',
            userId: this.currentUser.id,
            lastSync: localStorage.getItem('last_sync') || 0
        };
        
        // This would trigger the peer to send their posts
        // Implementation depends on your P2P protocol
    }
    
    async loadLocalFeed() {
        const posts = await this.db.getPosts(100);
        this.feedCache = posts;
        return posts;
    }
    
    async followUser(userId) {
        await this.db.follow(this.currentUser.id, userId);
        this.following.add(userId);
        
        // Broadcast follow action to network
        this.p2p.broadcastPost({
            type: 'follow',
            targetUserId: userId,
            timestamp: Date.now()
        });
    }
    
    async getTimeline(limit = 50) {
        // Get posts from followed users + self
        const followingList = Array.from(this.following);
        followingList.push(this.currentUser.id);
        
        // Query posts from these users
        const allPosts = await this.db.getPosts(limit * 2);
        const timeline = allPosts
            .filter(post => followingList.includes(post.authorId))
            .slice(0, limit);
        
        return timeline;
    }
}