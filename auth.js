const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, plan } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Check existing
    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existingUser) {
      if (existingUser.email === email.toLowerCase()) {
        return res.status(400).json({ message: 'Email already registered.' });
      }
      return res.status(400).json({ message: 'Username already taken.' });
    }

    const validPlans = ['dirt', 'stone', 'glass', 'bricks', 'obsidian', 'bedrock'];
    const selectedPlan = validPlans.includes(plan) ? plan : 'dirt';

    // Check if admin email
    const isAdmin = email.toLowerCase() === process.env.ADMIN_EMAIL;

    const user = new User({
      username,
      email: email.toLowerCase(),
      password,
      plan: selectedPlan,
      isAdmin
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        messagesUsed: user.messagesUsed,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email or username already exists.' });
    }
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Log attempt
    const logEntry = new LoginLog({
      email: email.toLowerCase(),
      ip,
      userAgent,
      success: false,
      username: user?.username
    });

    if (!user) {
      await logEntry.save();
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await logEntry.save();
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account has been deactivated.' });
    }

    // Success log
    logEntry.success = true;
    logEntry.userId = user._id;
    await logEntry.save();

    // Check monthly reset
    const now = new Date();
    const resetDate = new Date(user.messagesResetAt);
    const monthDiff = (now.getFullYear() - resetDate.getFullYear()) * 12 + now.getMonth() - resetDate.getMonth();
    if (monthDiff >= 1) {
      user.messagesUsed = 0;
      user.messagesResetAt = now;
      await user.save();
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful.',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        messagesUsed: user.messagesUsed,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  res.json({
    user: {
      _id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      plan: req.user.plan,
      messagesUsed: req.user.messagesUsed,
      isAdmin: req.user.isAdmin
    }
  });
});

module.exports = router;
