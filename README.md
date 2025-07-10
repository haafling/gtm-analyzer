# GTM Analyzer Worker

Architecture job queue + worker pour éviter les timeouts Railway.

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

### Endpoints

- **GET /**  
  Health check, renvoie `OK`.

- **POST /analyze**  
  Enqueue une analyse GTM.  
  ```json
  { "url": "https://example.com" }
  ```
  Réponse :  
  ```json
  { "jobId": "uuid-v4" }
  ```

- **GET /result/:jobId**  
  Récupère le statut et le résultat du job :  
  ```json
  { "status": "pending" }
  ```
  ou  
  ```json
  { "status": "done", "result": { url, gtmDomain, isProxified, isGTMFound } }
  ```
  ou  
  ```json
  { "status": "error", "error": "message" }
  ```
