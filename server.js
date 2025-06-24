/* server.js – keeps the HTTP plumbing separate from the bot brain
   --------------------------------------------------------------
   1. Loads secrets from .env.
   2. Boots an Express server.
   3. Mounts the WhatsApp bot router at /webhook.
   4. Listens on the port Render (or Heroku, Fly, etc.) gives us.

   Run locally:   node server.js
   In production  Render sets process.env.PORT automatically.
*/

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
//const nailBotRouter = require('./whatsappNailBot');
const whatsappRouter = require("./routes/whatsapp");

const app = express();

app.enable('trust proxy');

// Twilio sends application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
// Just in case we POST JSON in future admin routes
app.use(bodyParser.json());

// 👉 All WhatsApp traffic goes here
app.use(whatsappRouter);

// Simple health check so Render can see the container is alive
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
