const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');

const A_USER = process.env.ATERNOS_USER;
const A_PASS = process.env.ATERNOS_PASS;
const PROTECT = process.env.PROTECT_PASSWORD || 'Hanzo'; // default as you asked

if (!A_USER || !A_PASS) {
  console.error('Set ATERNOS_USER and ATERNOS_PASS as environment variables.');
  // still start so health-checks can work
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// simple UI
app.get('/', (req, res) => {
  res.send(`<h2>Start Aternos server</h2>
    <form method="POST" action="/start">
      <label>Password: <input name="pw" /></label>
      <button type="submit">Start server</button>
    </form>
  `);
});

app.post('/start', async (req, res) => {
  const pw = (req.body.pw || '').toString();
  if (pw !== PROTECT) {
    return res.status(403).json({ ok: false, error: 'wrong password' });
  }
  if (!A_USER || !A_PASS) {
    return res.status(500).json({ ok: false, error: 'server missing credentials' });
  }

  try {
    // Launch Puppeteer; Render needs no-sandbox flags
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    // Go to Aternos login (the flow may require JS/cookies)
    await page.goto('https://aternos.org/go/', { waitUntil: 'networkidle2' });

    // Attempt to click "Login" and fill form. The site is dynamic; selectors might need adjustment.
    // This is a best-effort approach; you may need to update selectors after inspecting Aternos HTML.
    try {
      await page.waitForSelector('input[type="text"], input[name="username"], input[name="user"]', { timeout: 5000 });
      // try a few likely selectors:
      const usernameSelector = await findSelector(page, ['input[name="username"]', 'input[name="user"]', 'input[type="text"]']);
      const passwordSelector = await findSelector(page, ['input[type="password"]', 'input[name="pass"]', 'input[name="password"]']);
      if (!usernameSelector || !passwordSelector) {
        throw new Error('login selectors not found; site structure changed');
      }
      await page.type(usernameSelector, A_USER, { delay: 40 });
      await page.type(passwordSelector, A_PASS, { delay: 40 });
      // submit - try to find submit button
      await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(()=>{})
      ]);
    } catch (e) {
      // maybe already logged in in session, continue
      console.warn('login step warning:', e.message);
    }

    // navigate to server page
    await page.goto('https://aternos.org/server/', { waitUntil: 'networkidle2' });

    // attempt to click a button that contains text 'Start'
    const startClicked = await clickButtonByText(page, ['Start', 'Start server', 'Start Server']);
    if (!startClicked) {
      await browser.close();
      return res.status(500).json({ ok: false, error: 'Start button not found (selector mismatch)' });
    }

    // After clicking Start, Aternos may force an ad overlay. Try to detect an ad iframe/overlay.
    await page.waitForTimeout(3000);
    const adFound = await page.$('iframe') || await page.$('.ads') || await page.$('.vjs-ad') || null;

    await browser.close();

    if (adFound) {
      // we can't reliably "show" that ad to the remote user via Render headless instance.
      return res.json({ ok: true, started: true, note: 'Start clicked. An ad was detected; Aternos typically requires watching this ad in a real browser. Automated ad-watching may not complete start.' });
    } else {
      return res.json({ ok: true, started: true, note: 'Start clicked; no ad detected by the bot. Monitor server in Aternos UI.' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// helper: find first selector that exists
async function findSelector(page, arr) {
  for (const s of arr) {
    try {
      const el = await page.$(s);
      if (el) return s;
    } catch (e) {}
  }
  return null;
}

// helper: click button by visible text using XPath
async function clickButtonByText(page, texts) {
  for (const t of texts) {
    const escaped = t.replace(/"/g, '\\"');
    const handles = await page.$x(`//button[contains(., "${escaped}")] | //a[contains(., "${escaped}")]`);
    if (handles.length) {
      await handles[0].click();
      return true;
    }
  }
  return false;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on', PORT));
