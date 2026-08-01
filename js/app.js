// Main application controller
class AlphaFold3Generator {
    constructor() {
        this.sequences = [];
        this.bondedAtomPairs = [];
        this.glycanData = null;
        this.glycanUserCCDs = {};
        this.sequenceCounter = 0;
        this.bondCounter = 0;
        
        this.init();
    }

    init() {
        // Initialize the application
        this.setupEventListeners();
        this.loadSugarDrawer();
        
        // Generate initial JSON
        setTimeout(() => {
            this.generateJSON();
        }, 100);
    }

    setupEventListeners() {
        // Auto-generate JSON when inputs change (using event delegation)
        document.body.addEventListener('input', (event) => {
            // Check if the changed element is an input we care about
            if (event.target.matches('input, select, textarea')) {
                this.debounceGenerate();
            }
        });
        
        // Also listen for change events
        document.body.addEventListener('change', (event) => {
            if (event.target.matches('input, select, textarea')) {
                this.debounceGenerate();
            }
        });
    }

    debounceGenerate() {
        if (this.isRestoringSharedInput) return;
        clearTimeout(this.generateTimeout);
        this.generateTimeout = setTimeout(() => {
            this.generateJSON();
        }, 500);
    }

    loadSugarDrawer() {
        // SugarDrawer now only available via popup modal
        // No embedded container initialization needed
    }

    getOutputTarget() {
        return document.getElementById('outputTarget')?.value || 'alphafold3';
    }

    getOutputTargetConfig() {
        const target = this.getOutputTarget();
        return window.JAAGCore?.TARGETS?.[target] || {
            target,
            name: target === 'protenix' ? 'Protenix' : target === 'opendde' ? 'OpenDDE' : 'AlphaFold 3',
            usesServerJSON: target === 'opendde' || target === 'protenix'
        };
    }

    updateOutputTargetUI() {
        const targetConfig = this.getOutputTargetConfig();
        const usesServerJSON = targetConfig.usesServerJSON;
        const versionSettings = document.getElementById('alphaFoldVersionSettings');
        const modelSeedSettings = document.getElementById('modelSeedSettings');
        const userCCDSection = document.getElementById('userCCDSection');
        const help = document.getElementById('outputTargetHelp');
        const outputLabel = document.getElementById('jsonOutputLabel');

        versionSettings?.classList.toggle('d-none', usesServerJSON);
        userCCDSection?.classList.toggle('d-none', usesServerJSON);
        if (modelSeedSettings) {
            modelSeedSettings.classList.toggle('col-md-8', !usesServerJSON);
            modelSeedSettings.classList.toggle('col-md-12', usesServerJSON);
        }
        if (help) {
            help.textContent = usesServerJSON
                ? `${targetConfig.name} job-list JSON. File-path MSAs are supported; inline MSA, AlphaFold template objects, and custom userCCD are not.`
                : 'AlphaFold 3 dialect, version 1–4';
        }
        if (outputLabel) {
            outputLabel.textContent = `${targetConfig.name} JSON Output`;
        }
    }

    async buildSupersetDocument(target = this.getOutputTarget()) {
        // Keep the mature DOM collector as a migration bridge; adapters consume only the neutral document.
        const collectedJob = await this.buildAlphaFold3JSON();
        const core = await window.JAAGCoreReady;
        return { collectedJob, inputDocument: core.fromAlphaFold3(collectedJob, { target }), core };
    }

    async generateJSON() {
        if (this.isRestoringSharedInput) return;
        try {
            const outputTarget = this.getOutputTarget();
            const { collectedJob, inputDocument, core } = await this.buildSupersetDocument(outputTarget);
            const conversion = core.serialize(inputDocument, outputTarget);
            const targetConfig = core.TARGETS[outputTarget];
            const formValidation = this.validateJSON(collectedJob);
            const errors = [...new Set([...formValidation.errors, ...conversion.errors])];
            const warnings = [...new Set([...formValidation.warnings, ...conversion.warnings])];
            const jsonData = conversion.data;
            const validation = { valid: errors.length === 0, errors, warnings };

            this.updateOutputTargetUI();
            this.updateValidationStatus(
                document.getElementById('validationStatus'), errors, warnings, targetConfig.name
            );

            this.lastValidation = validation;
            this.lastOutputTarget = outputTarget;
            this.lastOutputData = jsonData;
            this.lastInputDocument = inputDocument;
            
            const jsonString = JSON.stringify(jsonData, null, 2);

            const outputElement = document.getElementById('jsonOutput');

            if (outputElement) {
                outputElement.textContent = jsonString;
            }

        } catch (error) {
            this.lastValidation = { valid: false, errors: [error.message], warnings: [] };
            const outputElement = document.getElementById('jsonOutput');
            if (outputElement) outputElement.textContent = `Error: ${error.message}`;
            this.showError('JSON Generation Error: ' + error.message);
        }
    }

    // buildAlphaFold3JSON is now implemented in json-generator.js as a prototype method

    showSuccess(message) {
        this.showToast(message, 'success');
        this.addToDebugLog('SUCCESS', message);
    }

    showError(message) {
        this.showToast(message, 'danger');
        this.addToDebugLog('ERROR', message);
    }

    showWarning(message) {
        this.showToast(message, 'warning');
        this.addToDebugLog('WARNING', message);
    }

    showInfo(message) {
        this.showToast(message, 'info');
        this.addToDebugLog('INFO', message);
    }

    addToDebugLog(level, message) {
        const debugLog = document.getElementById('debugLog');
        if (!debugLog) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `debug-entry ${level.toLowerCase()}`;
        
        let icon, color;
        switch(level) {
            case 'ERROR':
                icon = '❌';
                color = '#dc3545';
                break;
            case 'WARNING':
                icon = '⚠️';
                color = '#ffc107';
                break;
            case 'SUCCESS':
                icon = '✅';
                color = '#28a745';
                break;
            default:
                icon = 'ℹ️';
                color = '#17a2b8';
        }
        
        logEntry.innerHTML = `
            <span style="color: ${color}; font-weight: bold;">[${timestamp}] ${icon} ${level}:</span>
            <span style="margin-left: 8px;">${message}</span>
        `;
        
        // Clear placeholder text if this is the first real entry
        if (debugLog.children.length === 1 && debugLog.children[0].classList.contains('text-muted')) {
            debugLog.innerHTML = '';
        }
        
        debugLog.appendChild(logEntry);
        debugLog.scrollTop = debugLog.scrollHeight; // Auto-scroll to bottom
    }

    showToast(message, type) {
        // Create or get the toast container
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'position-fixed';
            toastContainer.style.cssText = 'bottom: 20px; right: 20px; z-index: 1060; display: flex; flex-direction: column-reverse; gap: 10px; max-width: 350px;';
            document.body.appendChild(toastContainer);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `alert alert-${type} alert-dismissible fade show`;
        toast.style.cssText = 'margin: 0; min-width: 300px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); border: none; animation: slideInRight 0.3s ease-out;';
        toast.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="me-2">
                    ${this.getToastIcon(type)}
                </div>
                <div class="flex-grow-1">${message}</div>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

        // Add to container
        toastContainer.appendChild(toast);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOutRight 0.3s ease-in';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 5000);

        // Handle manual dismiss
        const closeBtn = toast.querySelector('.btn-close');
        closeBtn.addEventListener('click', () => {
            toast.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        });
    }

    getToastIcon(type) {
        switch(type) {
            case 'success':
                return '<i class="fas fa-check-circle text-success"></i>';
            case 'danger':
                return '<i class="fas fa-exclamation-circle text-danger"></i>';
            case 'warning':
                return '<i class="fas fa-exclamation-triangle text-warning"></i>';
            case 'info':
                return '<i class="fas fa-info-circle text-info"></i>';
            default:
                return '<i class="fas fa-bell"></i>';
        }
    }

}

// Global functions for HTML onclick handlers
function generateJSON() {
    app.generateJSON();
}

function copyJSON() {
    app.copyJSON();
}

function downloadJSON() {
    app.downloadJSON();
}

function updateOutputTarget() {
    if (!app) return;
    app.updateOutputTargetUI();
    app.generateJSON();
}


/**
 * Update the page title with the job name
 * @param {string} jobName - The job name to append to title
 */
function updatePageTitle(jobName) {
    const baseTitle = 'JAAG';
    if (jobName && jobName.trim() !== '') {
        document.title = `${baseTitle} - ${jobName}`;
    } else {
        document.title = baseTitle;
    }
}

/**
 * Validate job name input - only allow letters, numbers, hyphens, and underscores
 * @param {HTMLInputElement} input - The job name input element
 */
function validateJobName(input) {
    // Remove any invalid characters and update the input value
    const validValue = input.value.replace(/[^a-zA-Z0-9_-]/g, '');

    // If the value changed, update the input and show feedback
    if (input.value !== validValue) {
        input.value = validValue;

        // Add visual feedback
        input.classList.add('border-warning');
        setTimeout(() => {
            input.classList.remove('border-warning');
        }, 1000);

        // Show user notification if app is available
        if (window.app && window.app.showInfo) {
            window.app.showInfo('Invalid characters removed from job name. Only letters, numbers, hyphens, and underscores are allowed.');
        }
    }

    // Update page title with the job name
    updatePageTitle(validValue);

    // Additional validation for JSON generation
    if (validValue.length === 0) {
        input.classList.add('border-danger');
    } else {
        input.classList.remove('border-danger');
    }
}


/**
 * Generate multiple random seeds based on user input
 */
function generateMultipleSeeds() {
    const seedCountInput = document.getElementById('seedCount');
    const seedTypeSelect = document.getElementById('seedType');
    const multipleSeedsInput = document.getElementById('modelSeedsMultiple');

    let count = parseInt(seedCountInput.value);

    // Validate and auto-correct input
    if (!count || count < 1) {
        seedCountInput.value = 1;
        count = 1;
    } else if (count > 99999) {
        seedCountInput.value = 99999;
        count = 99999;
    }

    const seedType = seedTypeSelect.value;
    const seeds = [];

    if (seedType === 'consecutive') {
        // Generate consecutive seeds starting from 1
        for (let i = 1; i <= count; i++) {
            seeds.push(i);
        }
    } else {
        // Generate unique random seeds
        const min = 1;
        const max = 4294967295;

        while (seeds.length < count) {
            const randomSeed = Math.floor(Math.random() * (max - min + 1)) + min;
            // Ensure uniqueness
            if (!seeds.includes(randomSeed)) {
                seeds.push(randomSeed);
            }
        }
    }

    // Set the generated seeds in the input field with clean formatting
    multipleSeedsInput.value = seeds.join(', ');

    // Trigger JSON update
    if (window.app) {
        window.app.debounceGenerate();
    }
}

/**
 * Validate and auto-correct seed count input
 */
function validateSeedCountInput(input) {
    let value = parseInt(input.value);

    // Auto-correct values outside the valid range
    if (value < 1) {
        input.value = 1;
    } else if (value > 99999) {
        input.value = 99999;
    }
}

/**
 * Validate multiple seeds input
 */
function validateMultipleSeedsInput(input) {
    // Light validation during typing - just trigger JSON update
    if (window.app) {
        window.app.debounceGenerate();
    }
}

function cleanupMultipleSeedsInput(input) {
    let value = input.value.trim();

    if (!value) {
        return;
    }

    // Split by comma and validate each seed
    const seeds = value.split(',');
    const validSeeds = [];
    const min = 1;
    const max = 4294967295;

    for (let seed of seeds) {
        seed = seed.trim();

        // Skip empty values
        if (seed === '') continue;

        // Remove non-numeric characters
        seed = seed.replace(/[^0-9]/g, '');

        const numValue = parseInt(seed);

        if (numValue && numValue >= min && numValue <= max) {
            validSeeds.push(numValue);
        }
    }

    // Clean up and format the input with proper spacing
    if (validSeeds.length > 0) {
        input.value = validSeeds.join(', ');
    } else if (value && validSeeds.length === 0) {
        // If user entered something but all invalid, clear the field
        input.value = '';
    }

    // Trigger JSON update after cleanup
    if (window.app) {
        window.app.debounceGenerate();
    }
}


// Make functions globally accessible
window.updatePageTitle = updatePageTitle;
window.validateJobName = validateJobName;
window.generateMultipleSeeds = generateMultipleSeeds;
window.validateSeedCountInput = validateSeedCountInput;
window.validateMultipleSeedsInput = validateMultipleSeedsInput;
window.cleanupMultipleSeedsInput = cleanupMultipleSeedsInput;
window.updateOutputTarget = updateOutputTarget;

// Initialize the application when DOM is loaded
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new AlphaFold3Generator();
    // Make app globally accessible
    window.app = app;
    app.updateOutputTargetUI();

    // Generate and set a random seed as default
    const modelSeedsInput = document.getElementById('modelSeedsMultiple');
    if (modelSeedsInput && !modelSeedsInput.value) {
        const min = 1;
        const max = 4294967295; // Maximum 32-bit unsigned integer
        const randomSeed = Math.floor(Math.random() * (max - min + 1)) + min;
        modelSeedsInput.value = randomSeed;

        // Trigger JSON update to include the default seed
        if (window.app) {
            window.app.debounceGenerate();
        }
    }

    // Add event listener for Advanced Settings collapse toggle
    const advancedFunctionsButton = document.querySelector('[data-bs-target="#advancedFunctionsCollapse"]');
    const advancedFunctionsCollapse = document.getElementById('advancedFunctionsCollapse');

    if (advancedFunctionsButton && advancedFunctionsCollapse) {
        advancedFunctionsCollapse.addEventListener('show.bs.collapse', function() {
            const icon = advancedFunctionsButton.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-chevron-down me-1';
            }
        });

        advancedFunctionsCollapse.addEventListener('hide.bs.collapse', function() {
            const icon = advancedFunctionsButton.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-chevron-right me-1';
            }
        });
    }
});
