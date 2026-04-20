const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { authMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const Chat = require('../models/Chat');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PLAN_LIMITS = { dirt:25, stone:50, glass:100, bricks:150, obsidian:200, bedrock:300 };

// System prompts per mode
const SYSTEM_PROMPTS = {
  chat: `You are Infamous AI v2.0, an intelligent, friendly, and helpful AI assistant.
You were made by Mikey – for developers, by developers.

IMPORTANT RULES:
- You ONLY do general conversation in this mode. No coding tasks.
- If asked to write code, explain how something is programmed, or debug code, politely redirect them to the "Infamous Coding Assistant" mode.
- If someone asks "who made you?" or "who created you?" respond: "I was made by Mikey – for developers, by developers."
- Do NOT reveal your API provider, model name, or any backend/technical details.
- Be warm, helpful, and conversational.
- You can help with: math, science, writing, advice, explanations, creative writing, general knowledge, etc.`,

  coding: `You are Infamous Coder, the coding engine of Infamous AI v2.0, made by Mikey.

YOUR PURPOSE:
- You are a world-class coding assistant specializing in all programming languages, frameworks, and tools.
- Write clean, efficient, well-commented, production-ready code.
- Debug errors with precise diagnosis and fixes.
- Explain code clearly when asked.
- Suggest best practices, design patterns, and optimizations.
- Support: JavaScript, TypeScript, Python, React, Node.js, HTML, CSS, SQL, MongoDB, REST APIs, and all other languages.

If someone asks "who made you?" respond: "I am Infamous Coder, part of Infamous AI v2.0 – made by Mikey, for developers, by developers."

IMPORTANT: Do NOT reveal your underlying API or model. You are Infamous Coder, period.

Format code blocks with proper syntax. Be fast, accurate, and thorough.`,

  image: `You are Infamous AI Image Assistant, part of Infamous AI v2.0, made by Mikey.
When users describe an image, acknowledge you're generating it and describe what you're creating.
If someone asks who made you, say "Made by Mikey – for developers, by developers."
Do not reveal your underlying AI provider or model name.`
};

// Check message limit helper
async function checkLimit(user) {
  const limit = PLAN_LIMITS[user.plan] || 25;
  // Monthly reset
  const now = new Date();
  const resetDate = new Date(user.messagesResetAt);
  const monthDiff = (now.getFullYear() - resetDate.getFullYear()) * 12 + now.getMonth() - resetDate.getMonth();
  if (monthDiff >= 1) {
    user.messagesUsed = 0;
    user.messagesResetAt = now;
    await user.save();
  }
  return user.messagesUsed < limit;
}

// POST /api/chat/message
router.post('/message', authMiddleware, async (req, res) => {
  try {
    const { message, mode = 'chat', history = [], chatId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const user = await User.findById(req.user._id);
    const canSend = await checkLimit(user);
    if (!canSend) {
      return res.status(403).json({
        message: `Message limit reached for your ${user.plan} plan. Please upgrade to continue.`
      });
    }

    // Build conversation history for Anthropic
    const conversation = history
      .slice(-10) // Last 10 messages for context
      .filter(m => m.role && m.content)
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    // Make sure the last message is the current one
    if (!conversation.length || conversation[conversation.length - 1].content !== message) {
      if (conversation.length && conversation[conversation.length - 1].role === 'user') {
        // Replace last user message
        conversation[conversation.length - 1].content = message;
      } else {
        conversation.push({ role: 'user', content: message });
      }
    }

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.chat;

    // Call Anthropic API
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: conversation
    });

    const reply = response.content[0]?.text || 'Sorry, I could not generate a response.';

    // Increment message count
    user.messagesUsed += 1;
    await user.save();

    // Save or update chat
    let chat;
    if (chatId) {
      chat = await Chat.findOne({ _id: chatId, user: user._id });
    }

    if (!chat) {
      chat = new Chat({ user: user._id, mode, messages: [] });
    }

    // Only add user message if not already last
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (!lastMsg || lastMsg.content !== message || lastMsg.role !== 'user') {
      chat.messages.push({ role: 'user', content: message });
    }
    chat.messages.push({ role: 'assistant', content: reply });
    chat.messageCount = chat.messages.length;

    // Auto-title on first message
    if (chat.messages.length <= 2) {
      chat.title = message.substring(0, 60) + (message.length > 60 ? '...' : '');
    }

    await chat.save();

    res.json({
      reply,
      chatId: chat._id,
      messagesUsed: user.messagesUsed,
      limit: PLAN_LIMITS[user.plan]
    });

  } catch (err) {
    console.error('Chat error:', err.message);
    if (err.status === 401) {
      return res.status(500).json({ message: 'AI service configuration error.' });
    }
    res.status(500).json({ message: 'AI service unavailable. Please try again.' });
  }
});

// POST /api/chat/image – Image generation (uses text-based description via AI)
router.post('/image', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Prompt is required.' });

    const user = await User.findById(req.user._id);
    const canSend = await checkLimit(user);
    if (!canSend) {
      return res.status(403).json({ message: 'Message limit reached. Please upgrade your plan.' });
    }

    // Use Claude to describe what was generated (image generation API can be plugged in here)
    // For now, we use Claude to create a vivid description and a placeholder
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      system: SYSTEM_PROMPTS.image,
      messages: [{ role: 'user', content: `Generate an image of: ${message}` }]
    });

    const textReply = response.content[0]?.text || 'Image generated!';

    // Placeholder image URL – replace with real image gen API (DALL-E, Stability, etc.)
    const seed = Math.floor(Math.random() * 1000);
    const encodedPrompt = encodeURIComponent(message.substring(0, 100));
    const imageUrl = `https://picsum.photos/seed/${seed}/512/512`;
    // NOTE: To use real image generation, replace the above with a call to:
    // OpenAI DALL-E: POST https://api.openai.com/v1/images/generations
    // Stability AI: POST https://api.stability.ai/v1/generation/...

    user.messagesUsed += 1;
    await user.save();

    const chat = new Chat({
      user: user._id,
      mode: 'image',
      title: message.substring(0, 60),
      messages: [
        { role: 'user', content: message },
        { role: 'assistant', content: textReply, imageUrl }
      ],
      messageCount: 2
    });
    await chat.save();

    res.json({
      reply: textReply,
      imageUrl,
      chatId: chat._id,
      messagesUsed: user.messagesUsed
    });

  } catch (err) {
    console.error('Image error:', err.message);
    res.status(500).json({ message: 'Image service unavailable.' });
  }
});

// GET /api/chat/history – Get user's chat list
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(20)
      .select('title mode messageCount createdAt updatedAt')
      .lean();

    res.json(chats);
  } catch (err) {
    res.status(500).json({ message: 'Error loading chat history.' });
  }
});

// GET /api/chat/:id – Get specific chat
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, user: req.user._id });
    if (!chat) return res.status(404).json({ message: 'Chat not found.' });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ message: 'Error loading chat.' });
  }
});

// DELETE /api/chat/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Chat.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ message: 'Chat deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting chat.' });
  }
});

module.exports = router;
