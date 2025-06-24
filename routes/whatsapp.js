const express = require("express");
const { handleIncomingMessage } = require("../services/botService"); // Import the handler

const router = express.Router();

// Health check route (optional)
router.get("/", (_req, res) => res.send("Nail Shop Bot is running!"));

// Webhook POST route (main WhatsApp bot entry)
router.post("/webhook", handleIncomingMessage);

module.exports = router;