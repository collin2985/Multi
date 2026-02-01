/**
 * FingerprintCollector.js
 * Collects hardware signals for ban evasion detection
 * Only runs on login/register, not during gameplay
 */

export class FingerprintCollector {
    constructor() {
        this.signals = null;
    }

    /**
     * Collect all fingerprint signals
     * @returns {Promise<object>} Raw signals object
     */
    async collect() {
        this.signals = {
            webgl: this._getWebGLInfo(),
            canvas: await this._getCanvasHash(),
            screen: this._getScreenInfo(),
            hardware: this._getHardwareInfo(),
            browser: this._getBrowserInfo()
        };
        return this.signals;
    }

    /**
     * Generate SHA-256 hash of fingerprint
     * @returns {Promise<string>} Hex hash string (64 chars)
     */
    async getHash() {
        if (!this.signals) {
            await this.collect();
        }
        const signalString = JSON.stringify(this.signals);
        const encoder = new TextEncoder();
        const data = encoder.encode(signalString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Generate partial hashes for fuzzy matching
     * Returns hashes of stable signal subsets
     * @returns {Promise<object>} Object with partial hash keys
     */
    async getPartialHashes() {
        if (!this.signals) {
            await this.collect();
        }

        const partials = {};

        // GPU-only hash (WebGL renderer + vendor) - most stable
        partials.gpu = await this._hashSubset({
            renderer: this.signals.webgl?.renderer,
            vendor: this.signals.webgl?.vendor
        });

        // Hardware hash (CPU cores + device memory + screen)
        partials.hardware = await this._hashSubset({
            cores: this.signals.hardware?.cores,
            memory: this.signals.hardware?.memory,
            width: this.signals.screen?.width,
            height: this.signals.screen?.height
        });

        // Canvas hash standalone (already a hash)
        partials.canvas = this.signals.canvas;

        return partials;
    }

    /**
     * Get WebGL GPU information
     * @private
     */
    _getWebGLInfo() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return null;

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
                version: gl.getParameter(gl.VERSION),
                extensions: gl.getSupportedExtensions()?.length || 0
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Get canvas rendering hash
     * @private
     */
    async _getCanvasHash() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');

            // Draw deterministic content that reveals rendering differences
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('HorsesGame', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('HorsesGame', 4, 17);

            const dataUrl = canvas.toDataURL();
            const encoder = new TextEncoder();
            const data = encoder.encode(dataUrl);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            // Return first 16 chars for partial matching
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get screen information
     * @private
     */
    _getScreenInfo() {
        return {
            width: screen.width,
            height: screen.height,
            colorDepth: screen.colorDepth,
            pixelRatio: window.devicePixelRatio || 1
        };
    }

    /**
     * Get hardware information
     * @private
     */
    _getHardwareInfo() {
        return {
            cores: navigator.hardwareConcurrency || 0,
            memory: navigator.deviceMemory || 0,
            platform: navigator.platform,
            touchPoints: navigator.maxTouchPoints || 0
        };
    }

    /**
     * Get browser information
     * @private
     */
    _getBrowserInfo() {
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            languages: navigator.languages?.slice(0, 3) || [],
            cookiesEnabled: navigator.cookieEnabled
        };
    }

    /**
     * Hash a subset of signals
     * @private
     */
    async _hashSubset(obj) {
        const str = JSON.stringify(obj);
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    }
}
