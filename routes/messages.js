const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Send a message
router.post('/send', verifyToken, async (req, res) => {
  try {
    const { receiver_id, content } = req.body;

    if (!receiver_id || !content) {
      return res.status(400).json({ error: 'Receiver ID and content required' });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert([{
        sender_id: req.user.id,
        receiver_id,
        content,
        created_at: new Date()
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: data
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get conversation with a specific user
router.get('/conversation/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${req.user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${req.user.id})`)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      messages: data
    });
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all conversations (latest message per user)
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        sender:sender_id (id, full_name, avatar_url),
        receiver:receiver_id (id, full_name, avatar_url)
      `)
      .or(`sender_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by conversation partner
    const conversations = [];
    const seen = new Set();

    data.forEach(msg => {
      const otherUser = msg.sender_id === req.user.id ? msg.receiver : msg.sender;
      if (otherUser && !seen.has(otherUser.id)) {
        seen.add(otherUser.id);
        conversations.push({
          id: msg.id,
          user: otherUser,
          last_message: msg.content,
          last_message_time: msg.created_at,
          unread: msg.receiver_id === req.user.id && !msg.read ? 1 : 0
        });
      }
    });

    res.json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark message as read
router.put('/:messageId/read', verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;

    const { error } = await supabase
      .from('messages')
      .update({ read: true })
      .eq('id', messageId)
      .eq('receiver_id', req.user.id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Message marked as read'
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unread count
router.get('/unread/count', verifyToken, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', req.user.id)
      .eq('read', false);

    if (error) throw error;

    res.json({
      success: true,
      unreadCount: count
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;