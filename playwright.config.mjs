import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './browser-tests',
    workers: 1,
    timeout: 30000,
    use: {
        baseURL: 'http://127.0.0.1:8877',
        browserName: 'chromium',
        launchOptions: process.env.BIONUTA_CHROMIUM_PATH ? { executablePath: process.env.BIONUTA_CHROMIUM_PATH } : {}
    },
    webServer: { command: 'python3 -m http.server 8877 --bind 127.0.0.1', url: 'http://127.0.0.1:8877/', reuseExistingServer: false, timeout: 15000 }
});
