const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PLAN_LIMITS = {
  dirt: 25,
  stone: 50,
  glass: 100,
  bricks: 150,
  obsidian: 200,
  bedrock: 300
};

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [2, 'Username must be at least 2 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  plan: {
    type: String,
    enum: ['dirt', 'stone', 'glass', 'bricks', 'obsidian', 'bedrock'],
    default: 'dirt'
  },
  messagesUsed: {
    type: Number,
    default: 0
  },
  messagesResetAt: {
    type: Date,
    default: Date.now
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get message limit for plan
userSchema.methods.getMessageLimit = function() {
  return PLAN_LIMITS[this.plan] || 25;
};

// Check if user can send message
userSchema.methods.canSendMessage = function() {
  const limit = this.getMessageLimit();
  // Reset monthly
  const now = new Date();
  const resetDate = new Date(this.messagesResetAt);
  const monthDiff = (now.getFullYear() - resetDate.getFullYear()) * 12 + now.getMonth() - resetDate.getMonth();
  if (monthDiff >= 1) {
    this.messagesUsed = 0;
    this.messagesResetAt = now;
  }
  return this.messagesUsed < limit;
};

// Safe user object (no password)
userSchema.methods.toSafeObject = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
module.exports.PLAN_LIMITS = PLAN_LIMITS;
