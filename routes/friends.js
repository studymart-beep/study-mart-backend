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

// Get all people (for discovery)
router.get('/people', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        email,
        avatar_url,
        role,
        status,
        last_seen,
        friends_count
      `)
      .neq('id', req.user.id)
      .order('full_name');

    if (error) throw error;

    // Get friend status for each user
    const friendRequests = await supabase
      .from('friend_requests')
      .select('sender_id, receiver_id, status')
      .or(`sender_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`);

    const friends = await supabase
      .from('friends')
      .select('user_id, friend_id, status')
      .or(`user_id.eq.${req.user.id},friend_id.eq.${req.user.id}`);

    const friendMap = {};
    friendRequests.data?.forEach(req => {
      const otherId = req.sender_id === req.user.id ? req.receiver_id : req.sender_id;
      friendMap[otherId] = { status: req.status, type: 'request' };
    });

    friends.data?.forEach(friend => {
      const otherId = friend.user_id === req.user.id ? friend.friend_id : friend.user_id;
      friendMap[otherId] = { status: friend.status, type: 'friend' };
    });

    const usersWithStatus = data.map(user => ({
      ...user,
      friend_status: friendMap[user.id]?.status || 'none'
    }));

    res.json({
      success: true,
      users: usersWithStatus
    });
  } catch (error) {
    console.error('Error fetching people:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send friend request
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { receiver_id } = req.body;

    if (!receiver_id) {
      return res.status(400).json({ error: 'Receiver ID required' });
    }

    // Check if already friends
    const { data: existingFriend } = await supabase
      .from('friends')
      .select()
      .or(`and(user_id.eq.${req.user.id},friend_id.eq.${receiver_id}),and(user_id.eq.${receiver_id},friend_id.eq.${req.user.id})`)
      .single();

    if (existingFriend) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Check if request already exists
    const { data: existingRequest } = await supabase
      .from('friend_requests')
      .select()
      .or(`and(sender_id.eq.${req.user.id},receiver_id.eq.${receiver_id}),and(sender_id.eq.${receiver_id},receiver_id.eq.${req.user.id})`)
      .single();

    if (existingRequest) {
      return res.status(400).json({ error: 'Friend request already exists' });
    }

    const { data, error } = await supabase
      .from('friend_requests')
      .insert([{
        sender_id: req.user.id,
        receiver_id,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      request: data
    });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending friend requests
router.get('/requests', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .select(`
        *,
        sender:sender_id (
          id,
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('receiver_id', req.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      requests: data
    });
  } catch (error) {
    console.error('Error fetching friend requests:', error);
    res.status(500).json({ error: error.message });
  }
});

// Accept friend request
router.put('/request/:requestId/accept', verifyToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    // Get the request
    const { data: request, error: fetchError } = await supabase
      .from('friend_requests')
      .select()
      .eq('id', requestId)
      .eq('receiver_id', req.user.id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Update request status
    await supabase
      .from('friend_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    // Create friend relationship
    const { error: friendError } = await supabase
      .from('friends')
      .insert([{
        user_id: req.user.id,
        friend_id: request.sender_id,
        status: 'accepted'
      }]);

    if (friendError) throw friendError;

    // Update friends count for both users
    await supabase.rpc('increment_friends_count', { user_id: req.user.id });
    await supabase.rpc('increment_friends_count', { user_id: request.sender_id });

    res.json({
      success: true,
      message: 'Friend request accepted'
    });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reject friend request
router.put('/request/:requestId/reject', verifyToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    const { error } = await supabase
      .from('friend_requests')
      .update({ status: 'rejected' })
      .eq('id', requestId)
      .eq('receiver_id', req.user.id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Friend request rejected'
    });
  } catch (error) {
    console.error('Error rejecting friend request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get friends list
router.get('/list', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('friends')
      .select(`
        *,
        friend:friend_id (
          id,
          full_name,
          email,
          avatar_url,
          status,
          last_seen
        )
      `)
      .eq('user_id', req.user.id)
      .eq('status', 'accepted');

    if (error) throw error;

    res.json({
      success: true,
      friends: data.map(f => f.friend)
    });
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;