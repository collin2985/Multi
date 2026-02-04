/**
 * GPUWarningModal.js
 * Detects integrated GPU usage and warns users with instructions to switch to dedicated GPU
 */

const STORAGE_KEY = 'gpuWarningDismissed';

/**
 * Detect if browser is using integrated GPU
 * @param {THREE.WebGLRenderer} renderer - Three.js renderer instance
 * @returns {object} { isIntegrated, renderer: string, vendor: string }
 */
export function detectGPU(renderer) {
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    const gpuRenderer = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);

    const gpuVendor = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR);

    // Integrated GPU patterns
    const integratedPatterns = [
        /Intel.*(?:UHD|HD|Iris|Graphics)/i,
        /AMD.*Radeon.*Graphics/i,      // AMD APU integrated (not dedicated Radeon)
        /Vega\s*\d/i,                   // AMD Vega integrated
        /Microsoft Basic/i,             // Software renderer
        /SwiftShader/i,                 // Software renderer
        /llvmpipe/i                     // Software renderer (Linux)
    ];

    const isIntegrated = integratedPatterns.some(p => p.test(gpuRenderer));

    return {
        isIntegrated,
        renderer: gpuRenderer,
        vendor: gpuVendor
    };
}

/**
 * Check if user has dismissed the warning before
 */
function wasWarningDismissed() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/**
 * Save dismissal preference
 */
function saveDismissal(dontShowAgain) {
    if (dontShowAgain) {
        try {
            localStorage.setItem(STORAGE_KEY, 'true');
        } catch {
            // localStorage not available
        }
    }
}

/**
 * Show GPU warning modal if integrated GPU detected
 * @param {THREE.WebGLRenderer} renderer - Three.js renderer instance
 * @returns {boolean} true if warning was shown
 */
export function showGPUWarningIfNeeded(renderer) {
    // Skip if already dismissed
    if (wasWarningDismissed()) {
        return false;
    }

    const gpuInfo = detectGPU(renderer);

    if (!gpuInfo.isIntegrated) {
        return false;
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'gpuWarningModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Extract short GPU name for display
    const shortGpuName = gpuInfo.renderer
        .replace(/ANGLE \([^,]+,\s*/, '')
        .replace(/\s*Direct3D.*$/, '')
        .replace(/\s*\(0x[0-9A-Fa-f]+\)/, '')
        .trim();

    modal.innerHTML = `
        <div style="
            background: #3A342D;
            border: 3px solid #D4A855;
            border-radius: 8px;
            padding: 25px 35px;
            max-width: 480px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
        ">
            <h3 style="
                color: #D4A855;
                font-size: 22px;
                font-weight: bold;
                margin: 0 0 15px 0;
                font-family: Arial, sans-serif;
                text-align: center;
            ">Performance Warning</h3>

            <p style="
                color: #ddd;
                font-size: 14px;
                line-height: 1.5;
                margin: 0 0 10px 0;
            ">Your browser is using integrated graphics:</p>

            <p style="
                color: #D4A855;
                font-size: 13px;
                font-family: monospace;
                background: #2A2520;
                padding: 8px 12px;
                border-radius: 4px;
                margin: 0 0 15px 0;
                word-break: break-word;
            ">${shortGpuName}</p>

            <p style="
                color: #ddd;
                font-size: 14px;
                line-height: 1.5;
                margin: 0 0 12px 0;
            ">For better performance, switch to your dedicated GPU:</p>

            <div style="
                background: #2A2520;
                padding: 12px 15px;
                border-radius: 4px;
                margin: 0 0 15px 0;
            ">
                <p style="color: #aaa; font-size: 13px; margin: 0 0 10px 0; line-height: 1.6;">
                    <span style="color: #D4A855;">1.</span> Press <kbd style="background: #444; padding: 2px 6px; border-radius: 3px; color: #fff;">Win</kbd> + <kbd style="background: #444; padding: 2px 6px; border-radius: 3px; color: #fff;">S</kbd>, type "<span style="color: #fff;">graphics</span>", hit Enter
                </p>
                <p style="color: #aaa; font-size: 13px; margin: 0 0 10px 0; line-height: 1.6;">
                    <span style="color: #D4A855;">2.</span> Click <span style="color: #fff;">Browse</span>, navigate to:<br>
                    <span style="font-size: 11px; color: #888; margin-left: 16px; display: block; margin-top: 4px;">
                        Chrome: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe<br>
                        Edge: C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe
                    </span>
                </p>
                <p style="color: #aaa; font-size: 13px; margin: 0; line-height: 1.6;">
                    <span style="color: #D4A855;">3.</span> Click the added browser → <span style="color: #fff;">Options</span> → <span style="color: #fff;">High performance</span> → <span style="color: #fff;">Save</span>
                </p>
            </div>

            <p style="
                color: #888;
                font-size: 12px;
                margin: 0 0 20px 0;
                text-align: center;
            ">Restart your browser after making changes.</p>

            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
            ">
                <label style="
                    color: #888;
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                ">
                    <input type="checkbox" id="gpuWarningDontShow" style="cursor: pointer;">
                    Don't show again
                </label>

                <button id="gpuWarningOkBtn" style="
                    padding: 10px 35px;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: bold;
                    background: #D4A855;
                ">OK</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Button hover effect
    const okBtn = modal.querySelector('#gpuWarningOkBtn');
    okBtn.addEventListener('mouseenter', () => okBtn.style.background = '#C49745');
    okBtn.addEventListener('mouseleave', () => okBtn.style.background = '#D4A855');

    // Close handler
    okBtn.addEventListener('click', () => {
        const dontShow = modal.querySelector('#gpuWarningDontShow').checked;
        saveDismissal(dontShow);
        modal.remove();
    });

    return true;
}
