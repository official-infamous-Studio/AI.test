const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Announcement = require('../models/Announcement');
const LoginLog = require('../models/LoginLog');

// All admin routes require auth + admin
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ isAdmin: { $ne: true } });
    const totalChats = await Chat.countDocuments();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const newToday = await User.countDocuments({
      createdAt: { $gte: todayStart },
      isAdmin: { $ne: true }
    });

    // Messages sent today (count chat messages from today)
    const todayChats = await Chat.find({ updatedAt: { $gte: todayStart } }).select('messages');
    let msgsToday = 0;
    todayChats.forEach(c => {
      c.messages.forEach(m => { if (m.role === 'user') msgsToday++; });
    });

    // Plan distribution
    const plans = ['dirt', 'stone', 'glass', 'bricks', 'obsidian', 'bedrock'];
    const planDist = {};
    for (const plan of plans) {
      planDist[plan] = await User.countDocuments({ plan, isAdmin: { $ne: true } });
    }

    // Recent users (last 10)
    const recentUsers = await User.find({ isAdmin: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('username email plan createdAt');

    res.json({ totalUsers, totalChats, newToday, msgsToday, planDist, recentUsers });
  } catch (err) {
    res.status(500).json({ message: 'Error loading stats.' });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ isAdmin: { $ne: true } })
      .sort({ createdAt: -1 })
      .select('-password')
      .lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error loading users.' });
  }
});

// PATCH /api/admin/users/:id/plan
router.patch('/users/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    const validPlans = ['dirt', 'stone', 'glass', 'bricks', 'obsidian', 'bedrock'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan.' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { plan },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'Plan updated.', user });
  } catch (err) {
    res.status(500).json({ message: 'Error updating plan.' });
  }
});

// PATCH /api/admin/users/:id/reset-messages
router.patch('/users/:id/reset-messages', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { messagesUsed: 0, messagesResetAt: new Date() },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'Messages reset.', user });
  } catch (err) {
    res.status(500).json({ message: 'Error resetting messages.' });
  }
});

// PATCH /api/admin/users/:id/deactivate
router.patch('/users/:id/deactivate', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User deactivated.', user });
  } catch (err) {
    res.status(500).json({ message: 'Error deactivating user.' });
  }
});

// GET /api/admin/chats
router.get('/chats', async (req, res) => {
  try {
    const chats = await Chat.find()
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('user', 'username email plan')
      .lean();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: 'Error loading chats.' });
  }
});

// GET /api/admin/chats/:userId – Chats by user
router.get('/chats/user/:userId', async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.params.userId })
      .sort({ updatedAt: -1 })
      .populate('user', 'username email')
      .lean();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: 'Error loading user chats.' });
  }
});

// GET /api/admin/announcements
router.get('/announcements', async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: 'Error loading announcements.' });
  }
});

// POST /api/admin/announcements
router.post('/announcements', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ message: 'Title and body are required.' });
    }

    const announcement = new Announcement({
      title,
      body,
      createdBy: req.user._id
    });
    await announcement.save();
    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ message: 'Error creating announcement.' });
  }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Announcement deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting announcement.' });
  }
});

// GET /api/admin/login-logs
router.get('/login-logs', async (req, res) => {
  try {
    const logs = await LoginLog.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Error loading login logs.' });
  }
});

module.exports = router;
