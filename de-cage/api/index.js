// Vercel-ingang: alle verzoeken komen hier binnen (zie vercel.json).
const { createApp } = require('../server');
const { openDb } = require('../db');

module.exports = createApp(openDb());
