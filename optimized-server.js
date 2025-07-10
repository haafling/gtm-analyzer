const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const pLimit  = require('p-limit');
const psl     = require('psl');

const app = express();

// Logue chaque requête
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json({ limit: '10kb' }));
const limit = pLimit(1);

// Health check
app.get('/', (_req, res) => res.send('OK'));

// Analyse GTM
app.post('/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  console.log('Analyzing:', url);

  try {
    const result = await limit(() => analyzeGTM(url));
    return res.json(result);
  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: 'Analysis failed' });
  }
});

async function analyzeGTM(url) {
  const resp = await axios.get(url, { timeout: 15000 });
  const $    = cheerio.load(resp.data);
  const host = new URL(url).hostname;
  const main = psl.get(host) || host;

  let found = false, prox = false, dom = '';

  $('script').each((_, el) => {
    if (found) return;
    const src = $(el).attr('src') || '';
    const inl = $(el).html() || '';
    if (src.includes('?id=GTM-')) {
      found = true;
      dom   = new URL(src.startsWith('//') ? 'https:' + src : src).hostname;
      if (!dom.includes('google') && dom.endsWith(main)) prox = true;
    } else if (/GTM-[A-Z0-9]+/.test(inl)) {
      found = true;
      if (new RegExp(`\\b${main.replace('.', '\\.')}`, 'i').test(inl)) {
        prox = true;
        dom  = host;
      }
    }
  });

  if (!found) {
    $('script').each((_, el) => {
      const txt = ($(el).attr('src')||'') + ($(el).html()||'');
      if (txt.includes('?aw=')) {
        found = true;
        if (txt.includes(main)) {
          prox = true;
          dom  = host;
        }
        return false;
      }
    });
  }

  return { url, gtmDomain: dom, isProxified: prox, isGTMFound: found };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});