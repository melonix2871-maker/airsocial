// lib/auth.js - WebAuthn/Passkeys implementation
export class WebAuthnAuth {
    constructor() {
        this.rpId = window.location.hostname;
        this.rpName = 'P2P Social Network';
        this.origin = window.location.origin;
    }
    
    async register(userDetails) {
        try {
            // Generate challenge
            const challenge = this.generateChallenge();
            
            // Create credential
            const publicKeyCredential = await navigator.credentials.create({
                publicKey: {
                    challenge: challenge,
                    rp: {
                        name: this.rpName,
                        id: this.rpId
                    },
                    user: {
                        id: new TextEncoder().encode(userDetails.username),
                        name: userDetails.username,
                        displayName: userDetails.displayName
                    },
                    pubKeyCredParams: [
                        { type: 'public-key', alg: -7 },  // ES256
                        { type: 'public-key', alg: -257 } // RS256
                    ],
                    authenticatorSelection: {
                        authenticatorAttachment: 'platform',
                        requireResidentKey: true,
                        residentKey: 'required',
                        userVerification: 'required'
                    },
                    attestation: 'none',
                    timeout: 60000
                }
            });
            
            // Store credential info
            const credentialData = {
                success: true,
                credentialId: this.arrayBufferToBase64(publicKeyCredential.rawId),
                userId: userDetails.username,
                username: userDetails.username,
                displayName: userDetails.displayName,
                publicKey: this.arrayBufferToBase64(publicKeyCredential.response.getPublicKey()),
                attestationObject: this.arrayBufferToBase64(publicKeyCredential.response.attestationObject)
            };
            
            // Save locally (in production, this would be encrypted)
            localStorage.setItem(`webauthn_cred_${userDetails.username}`, JSON.stringify(credentialData));
            
            return credentialData;
        } catch (error) {
            console.error('WebAuthn registration error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async authenticate() {
        try {
            // Get available credentials (simplified - in production, you'd query your backend)
            const savedCreds = this.getSavedCredentials();
            
            if (savedCreds.length === 0) {
                throw new Error('No saved credentials found. Please register first.');
            }
            
            const challenge = this.generateChallenge();
            
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: challenge,
                    rpId: this.rpId,
                    allowCredentials: savedCreds.map(cred => ({
                        id: this.base64ToArrayBuffer(cred.credentialId),
                        type: 'public-key'
                    })),
                    userVerification: 'required',
                    timeout: 60000
                }
            });
            
            // Verify the assertion (in production, verify signature with public key)
            const authData = {
                success: true,
                credentialId: this.arrayBufferToBase64(assertion.rawId),
                authenticatorData: this.arrayBufferToBase64(assertion.response.authenticatorData),
                signature: this.arrayBufferToBase64(assertion.response.signature),
                userHandle: assertion.response.userHandle ? 
                    new TextDecoder().decode(assertion.response.userHandle) : null
            };
            
            return authData;
        } catch (error) {
            console.error('WebAuthn authentication error:', error);
            return { success: false, error: error.message };
        }
    }
    
    getSavedCredentials() {
        const credentials = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('webauthn_cred_')) {
                try {
                    const cred = JSON.parse(localStorage.getItem(key));
                    credentials.push(cred);
                } catch (e) {
                    console.error('Failed to parse credential:', e);
                }
            }
        }
        return credentials;
    }
    
    generateChallenge() {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        return challenge;
    }
    
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}