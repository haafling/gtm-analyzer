# GTM Analyzer

API légère pour détecter la présence et la proxification de Google Tag Manager sur une page.

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

### Endpoint
- `POST /analyze`  
  Body JSON: `{ "url": "https://example.com" }`

Réponse JSON:
```json
{
  "url": "...",
  "gtmDomain": "...",
  "isProxified": true|false,
  "isGTMFound": true|false
}
```
