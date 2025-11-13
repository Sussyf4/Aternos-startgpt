const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');

// Add stealth plugin to hide that we are a bot
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURATION ---
const USERNAME = process.env.ATERNOS_USER;
const PASSWORD = process.env.ATERNOS_PASS;
const APP_PASSWORD = process.env.WEB_PASS || 'Hanzo'; // Protection for your site

// The main automation logic
async function startAternosServer() {
    let browser = null;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: true, // Set to false if you want to see it locally
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process' // Required for Render sometimes
            ]
        });

        const page = await browser.newPage();
        
        // 1. Login
        console.log('Navigating to login...');
        await page.goto('https://aternos.org/go/', { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if we need to accept cookies first
        try {
            const consentBtn = await page.$('.cc-btn.cc-dismiss');
            if (consentBtn) await consentBtn.click();
        } catch (e) { /* Ignore if no cookie banner */ }

        console.log('Typing credentials...');
        await page.type('#user', USERNAME);
        await page.type('#password', PASSWORD);
        
        await Promise.all([
            page.click('#login'),
            page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);

        // Check for login failure
        if (page.url().includes('login')) {
            throw new Error('Login failed. Check credentials or CAPTCHA.');
        }

        // 2. Select Server (if multiple, this picks the first one usually, or goes straight to server page)
        console.log('Logged in. Checking server page...');
        if (!page.url().includes('/server/')) {
            // If we are on the account page, click the first server
            await page.click('.server-body');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }

        // 3. Check Status
        // Status classes: offline, online, loading, queueing
        const statusElement = await page.waitForSelector('.status-label');
        const status = await page.evaluate(el => el.innerText, statusElement);
        console.log(`Current Status: ${status}`);

        if (status.toLowerCase().includes('online')) {
            return 'Server is already ONLINE!';
        }

        // 4. Click Start
        console.log('Attempting to click Start...');
        const startBtn = await page.$('#start');
        if (!startBtn) throw new Error('Start button not found.');

        await startBtn.click();

        // 5. Handle the "Ads" / Confirmation Modal
        // Aternos often shows a modal asking to confirm notification or watch ad
        console.log('Waiting for confirmation modal...');
        
        // Wait a bit for modal animation
        await new Promise(r => setTimeout(r, 2000));

        // Try to find the red "Yes, I accept" or confirm button in the notification modal
        // The selector often changes, but usually looks for btn-success or similar inside a modal
        try {
            // Look for the "Confirm" button specifically for the queue/ad
            const confirmSelector = '.btn.btn-danger.btn-huge.btn-block'; // Usually the "Yes" button
            await page.waitForSelector(confirmSelector, { timeout: 5000 });
            await page.click(confirmSelector);
            console.log('Clicked confirmation.');
        } catch (e) {
            console.log('No immediate confirmation modal found, checking for queue...');
        }

        // 6. Wait for success indication
        // We wait a few seconds to ensure the request went through
        await new Promise(r => setTimeout(r, 5000));

        return 'Start command sent! Check Aternos in a few minutes.';

    } catch (error) {
        console.error('Automation Error:', error);
        // Take a screenshot for debugging (saved to memory/logs in this case)
        if (browser) {
            const pages = await browser.pages();
            if (pages.length > 0) {
                const title = await pages[0].title();
                console.log(`Error occurred on page: ${title}`);
            }
        }
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// API Endpoint
app.post('/api/start', async (req, res) => {
    const { password } = req.body;

    if (password !== APP_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Wrong Password (Hanzo)' });
    }

    try {
        const result = await startAternosServer();
        res.json({ success: true, message: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message || 'Failed to start server.' });
    }
});

// Serve the HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

