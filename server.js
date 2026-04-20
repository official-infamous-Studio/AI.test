require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS – allow your frontend origin
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5500',   // VS Code Live Server
    'http://127.0.0.1:5500',
    'http://localhost:8080',
    'null' // file:// for local HTML files
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

// Rate limiting – general
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { message: 'Too many requests. Please slow down.' }
});

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' }
});

// Stricter limit for chat (prevent abuse)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { message: 'Slow down! Too many messages per minute.' }
});

app.use(generalLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/chat', chatLimiter, require('./routes/chat'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    version: '2.0.0',
    message: 'Infamous AI v2.0 Backend – Online',
    timestamp: new Date().toISOString()
  });
});

// Announcements for users (public after auth)
app.get('/api/announcements', require('./middleware/auth').authMiddleware, async (req, res) => {
  try {
    const Announcement = require('./models/Announcement');
    const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(5).lean();
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Error loading announcements.' });
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ message: 'Internal server error.' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── MongoDB + Start ──────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`\n🚀 Infamous AI v2.0 Backend running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔑 Admin email: ${process.env.ADMIN_EMAIL}`);
      console.log('─────────────────────────────────────────');
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

module.exports = app;
