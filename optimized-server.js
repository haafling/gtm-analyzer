const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const pLimit  = require('p-limit');
const psl     = require('psl');

const app = express();

// DEBUG : log de toutes les requêtes entrantes
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json({ limit: '10kb' }));
const limit = pLimit(1);

// Déclaration de la route POST /analyze
app.post('/analyze', async (req, res) => {
  const { url } = req.body;
  console.log('Analyzing:', url);
  // … le reste de ta logique d’analyse
});

function validateUrl(req, res, next) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    new URL(url);
    next();
  } catch {
    return res.status(400).json({ error: 'URL invalid' });
  }
}

app.post('/analyze', validateUrl, async (req, res) => {
  const { url } = req.body;
  console.log(`Analyzing: ${url}`);
  try {
    await limit(() =>
      analyzeGTM(url).then((result) => res.json(result))
    );
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: 'Failed to analyze page' });
  }
});

async function analyzeGTM(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Node.js) Server',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html'
    },
    timeout: 15000
  });

  const html = response.data;
  const $ = cheerio.load(html);
  const siteHostname = new URL(url).hostname;
  const mainDomain = psl.get(siteHostname) || siteHostname;

  let isGTMFound = false;
  let isProxified = false;
  let gtmDomain = '';

  $('script').each((_, el) => {
    if (isGTMFound) return;
    const src = $(el).attr('src') || '';
    const inline = $(el).html() || '';

    if (src.includes('?id=GTM-')) {
      isGTMFound = true;
      let full = src.startsWith('//') ? 'https:' + src : src;
      try {
        const host = new URL(full).hostname;
        gtmDomain = host;
        if (!host.includes('google') && host.endsWith(mainDomain)) {
          isProxified = true;
        }
      } catch {}
      return;
    }

    const inlineMatch = inline.match(/GTM-[A-Z0-9]+/);
    if (inlineMatch) {
      isGTMFound = true;
      if (new RegExp(`\\b${mainDomain.replace('.', '\\.')}`, 'i').test(inline)) {
        isProxified = true;
        gtmDomain = siteHostname;
      }
      return;
    }
  });

  if (!isGTMFound) {
    $('script').each((_, el) => {
      const content = ($(el).attr('src') || '') + ($(el).html() || '');
      if (content.includes('?aw=')) {
        isGTMFound = true;
        if (content.includes(mainDomain)) {
          isProxified = true;
          gtmDomain = siteHostname;
        }
        return false;
      }
    });
  }

  return { url, gtmDomain, isProxified, isGTMFound };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
