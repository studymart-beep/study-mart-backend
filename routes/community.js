const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Setup multer for image uploads
const uploadDir = path.join(__dirname, '../uploads/community');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

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

// GET /api/community/posts - fetch feed posts
router.get('/posts', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Get posts with author info
    const { data: posts, error } = await supabase
      .from('posts')
      .select(`
        *,
        user:user_id (id, full_name, avatar_url, role)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (!posts || posts.length === 0) {
      return res.json({ success: true, posts: [] });
    }

    const postIds = posts.map(p => p.id);

    // Get all likes for these posts
    const { data: allLikes } = await supabase
      .from('post_likes')
      .select('post_id, user_id')
      .in('post_id', postIds);

    // Calculate like counts and user's liked posts
    const likeCountMap = {};
    const userLikesSet = new Set();

    allLikes?.forEach(like => {
      likeCountMap[like.post_id] = (likeCountMap[like.post_id] || 0) + 1;
      if (like.user_id === req.user.id) {
        userLikesSet.add(like.post_id);
      }
    });

    const transformed = posts.map(post => ({
      ...post,
      likes: likeCountMap[post.id] || 0,
      liked: userLikesSet.has(post.id),
      user: post.user
    }));

    res.json({ success: true, posts: transformed });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/posts - create a new post
router.post('/posts', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const image_url = req.file ? `/uploads/community/${req.file.filename}` : null;

    const { data, error } = await supabase
      .from('posts')
      .insert([{
        user_id: req.user.id,
        content,
        image_url,
        created_at: new Date()
      }])
      .select(`
        *,
        user:user_id (id, full_name, avatar_url, role)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, post: data });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/posts/:id/like - toggle like
router.post('/posts/:id/like', verifyToken, async (req, res) => {
  try {
    const postId = req.params.id;

    const { data: existing } = await supabase
      .from('post_likes')
      .select()
      .eq('user_id', req.user.id)
      .eq('post_id', postId)
      .maybeSingle();

    if (existing) {
      // Unlike
      await supabase
        .from('post_likes')
        .delete()
        .eq('id', existing.id);
      
      // Get updated count
      const { count } = await supabase
        .from('post_likes')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', postId);
      
      res.json({ success: true, liked: false, likes: count });
    } else {
      // Like
      await supabase
        .from('post_likes')
        .insert([{ user_id: req.user.id, post_id: postId }]);
      
      const { count } = await supabase
        .from('post_likes')
        .select('*', { count: 'exact', head: true })
        .eq('post_id', postId);
      
      res.json({ success: true, liked: true, likes: count });
    }
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/groups - list groups with membership status
router.get('/groups', verifyToken, async (req, res) => {
  try {
    const { data: groups, error } = await supabase
      .from('groups')
      .select(`
        *,
        members:group_members(count)
      `)
      .order('name');

    if (error) throw error;

    // Get user's memberships
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', req.user.id);

    const joinedSet = new Set(myGroups?.map(g => g.group_id) || []);

    const transformed = groups.map(group => ({
      ...group,
      members: group.members?.[0]?.count || 0,
      joined: joinedSet.has(group.id)
    }));

    res.json({ success: true, groups: transformed });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/groups/:id/join - join a group
router.post('/groups/:id/join', verifyToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    const { data: existing } = await supabase
      .from('group_members')
      .select()
      .eq('user_id', req.user.id)
      .eq('group_id', groupId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Already a member' });
    }

    await supabase
      .from('group_members')
      .insert([{ user_id: req.user.id, group_id: groupId }]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/groups/:id/leave - leave a group
router.post('/groups/:id/leave', verifyToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    await supabase
      .from('group_members')
      .delete()
      .eq('user_id', req.user.id)
      .eq('group_id', groupId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving group:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/messages - list user's conversations
router.get('/messages', verifyToken, async (req, res) => {
  try {
    // Get all messages where user is sender or receiver
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

    // Group by conversation partner (get only the latest message per other user)
    const conversations = [];
    const seen = new Set();
    
    data.forEach(msg => {
      const otherUser = msg.sender_id === req.user.id ? msg.receiver : msg.sender;
      if (otherUser && !seen.has(otherUser.id)) {
        seen.add(otherUser.id);
        conversations.push({
          id: msg.id,
          with_id: otherUser.id,
          with_name: otherUser.full_name,
          with_avatar: otherUser.avatar_url,
          last_message: msg.content,
          updated_at: msg.created_at,
          unread: msg.receiver_id === req.user.id && !msg.read_at ? 1 : 0
        });
      }
    });

    res.json({ success: true, messages: conversations });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/messages - send a new message
router.post('/messages', verifyToken, async (req, res) => {
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
      .select(`
        *,
        sender:sender_id (id, full_name, avatar_url),
        receiver:receiver_id (id, full_name, avatar_url)
      `)
      .single();

    if (error) throw error;

    res.json({ success: true, message: data });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/contributors - top contributors
router.get('/contributors', async (req, res) => {
  try {
    // Get all posts
    const { data: posts, error } = await supabase
      .from('posts')
      .select('user_id');

    if (error) throw error;

    // Count posts per user manually
    const userPostCounts = {};
    posts.forEach(post => {
      userPostCounts[post.user_id] = (userPostCounts[post.user_id] || 0) + 1;
    });

    // Sort and get top 5
    const topUserIds = Object.entries(userPostCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(entry => entry[0]);

    if (topUserIds.length === 0) {
      return res.json({ success: true, contributors: [] });
    }

    // Get user details
    const { data: users, error: userError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role')
      .in('id', topUserIds);

    if (userError) throw userError;

    const contributors = topUserIds.map(id => ({
      ...users.find(u => u.id === id),
      posts: userPostCounts[id]
    }));

    res.json({ success: true, contributors });
  } catch (error) {
    console.error('Error fetching contributors:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/events - upcoming events
router.get('/events', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .gte('date', new Date().toISOString())
      .order('date', { ascending: true })
      .limit(5);

    if (error) throw error;

    res.json({ success: true, events: data });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/events/:id/attend
router.post('/events/:id/attend', verifyToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    
    // Check if already attending
    const { data: existing } = await supabase
      .from('event_attendees')
      .select()
      .eq('user_id', req.user.id)
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Already attending' });
    }

    await supabase
      .from('event_attendees')
      .insert([{ user_id: req.user.id, event_id: eventId }]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error attending event:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/events/:id - get event details
router.get('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Get attendee count
    const { count } = await supabase
      .from('event_attendees')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', id);

    res.json({ 
      success: true, 
      event: { ...data, attendees: count } 
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/community/users/:id - get user profile with community stats
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role, bio, expertise, created_at')
      .eq('id', id)
      .single();

    if (profileError) throw profileError;

    // Get user's post count
    const { count: postCount } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', id);

    // Get user's groups
    const { data: groups } = await supabase
      .from('group_members')
      .select('group:group_id (id, name)')
      .eq('user_id', id);

    res.json({
      success: true,
      profile: {
        ...profile,
        postCount,
        groups: groups?.map(g => g.group) || []
      }
    });
  } catch (error) {
    console.error('Error fetching user community profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'Community routes are working' });
});

module.exports = router;