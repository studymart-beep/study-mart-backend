const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://study-mart-phi.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const communityRoutes = require('./routes/community');
const friendsRoutes = require('./routes/friends');
const messagesRoutes = require('./routes/messages');
const coursesRoutes = require('./routes/courses');
const paymentRoutes = require('./routes/payment');
const sellerRoutes = require('./routes/seller');
const adminRoutes = require('./routes/admin');
const communityProfilesRoutes = require('./routes/community-profiles');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/community-profiles', communityProfilesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Study Mart Backend API', 
    status: 'active',
    endpoints: [
      '/api/auth',
      '/api/user',
      '/api/community',
      '/api/friends',
      '/api/messages',
      '/api/courses',
      '/api/payment',
      '/api/seller',
      '/api/admin',
      '/api/community-profiles',
      '/api/health'
    ]
  });
});

// Test route for posts (since frontend uses /api/posts/feed)
app.get('/api/posts/feed', (req, res) => {
  res.json({
    success: true,
    posts: [
      {
        id: '1',
        content: 'Welcome to Study Mart!',
        image_url: null,
        likes: 5,
        comments: 2,
        created_at: new Date().toISOString(),
        user: {
          id: '1',
          full_name: 'Admin User',
          avatar_url: null,
          role: 'admin'
        }
      },
      {
        id: '2',
        content: 'Learning React is fun!',
        image_url: null,
        likes: 3,
        comments: 1,
        created_at: new Date().toISOString(),
        user: {
          id: '2',
          full_name: 'John Student',
          avatar_url: null,
          role: 'student'
        }
      }
    ]
  });
});

// Test route for creating posts
app.post('/api/posts', (req, res) => {
  const { content, image_url } = req.body;
  res.json({
    success: true,
    post: {
      id: Date.now().toString(),
      content,
      image_url,
      likes: 0,
      comments: 0,
      created_at: new Date().toISOString(),
      user: {
        id: req.user?.id || '1',
        full_name: 'Current User',
        avatar_url: null,
        role: 'student'
      }
    }
  });
});

// Test route for user profile
app.get('/api/user/profile', (req, res) => {
  res.json({
    success: true,
    profile: {
      id: '1',
      full_name: 'Test User',
      email: 'user@example.com',
      avatar_url: null,
      role: 'student'
    }
  });
});

// Test route for messages unread count
app.get('/api/messages/unread/count', (req, res) => {
  res.json({
    success: true,
    unreadCount: 0
  });
});

// Test route for conversations
app.get('/api/messages/conversations', (req, res) => {
  res.json({
    success: true,
    conversations: []
  });
});

// Test route for friend requests
app.get('/api/friends/requests', (req, res) => {
  res.json({
    success: true,
    requests: []
  });
});

// Test route for sent requests
app.get('/api/friends/sent', (req, res) => {
  res.json({
    success: true,
    sent: []
  });
});

// Test route for groups
app.get('/api/groups', (req, res) => {
  res.json({
    success: true,
    groups: [
      {
        id: '1',
        name: 'React Developers',
        description: 'Learn React together',
        members: 25,
        icon: '⚛️',
        joined: false
      },
      {
        id: '2',
        name: 'JavaScript Masters',
        description: 'Advanced JavaScript',
        members: 18,
        icon: '📜',
        joined: true
      }
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});