
const express = require("express");
const router = express.Router();
const { listServices } = require("../services/serviceService");


router.get('/api/services', async (req, res) => {
  try {
    const services = await listServices(); // This should return all service rows
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

module.exports = router;