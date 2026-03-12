const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();

// CORS configuration - Allow both localhost and production frontend
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'https://study-mart-phi.vercel.app',
    'https://study-mart.vercel.app',
    'https://www.study-mart.vercel.app'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directories if they don't exist
const uploadsDir = path.join(__dirname, 'uploads');
const communityUploadsDir = path.join(__dirname, 'uploads/community');
const productUploadsDir = path.join(__dirname, 'uploads/products');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Uploads folder created at:', uploadsDir);
}
if (!fs.existsSync(communityUploadsDir)) {
  fs.mkdirSync(communityUploadsDir, { recursive: true });
  console.log('📁 Community uploads folder created at:', communityUploadsDir);
}
if (!fs.existsSync(productUploadsDir)) {
  fs.mkdirSync(productUploadsDir, { recursive: true });
  console.log('📁 Product uploads folder created at:', productUploadsDir);
}

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    }
    if (filePath.match(/\.(mp4|webm|ogg)$/)) {
      res.setHeader('Content-Type', `video/${path.extname(filePath).slice(1)}`);
    }
  }
}));

// Test endpoint to check uploads folder
app.get('/test-uploads', (req, res) => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ success: false, error: 'Uploads folder does not exist', path: uploadsDir });
    }
    const files = fs.readdirSync(uploadsDir);
    res.json({
      success: true,
      message: 'Uploads folder exists',
      files,
      path: uploadsDir,
      fileUrls: files.map(f => `/uploads/${f}`),
      totalFiles: files.length
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const adminRoutes = require('./routes/admin');
const communityRoutes = require('./routes/community');
const paymentRoutes = require('./routes/payment');
const sellerRoutes = require('./routes/seller');
const friendsRoutes = require('./routes/friends');
const messagesRoutes = require('./routes/messages');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);

// Basic route for testing
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Study-Mart API',
    status: 'Server is running',
    version: '1.0.0',
    endpoints: {
      auth: {
        signup: 'POST /api/auth/signup',
        signin: 'POST /api/auth/signin',
        signout: 'POST /api/auth/signout',
        me: 'GET /api/auth/me',
        test: 'GET /api/auth/test'
      },
      users: {
        profile: 'GET /api/users/profile',
        updateProfile: 'PUT /api/users/profile',
        instructors: 'GET /api/users/instructors',
        applyInstructor: 'POST /api/users/apply-instructor',
        publicProfile: 'GET /api/users/:id/profile',
        people: 'GET /api/users/people'
      },
      courses: {
        list: 'GET /api/courses',
        details: 'GET /api/courses/:id',
        create: 'POST /api/courses',
        update: 'PUT /api/courses/:id',
        submit: 'POST /api/courses/:id/submit',
        categories: 'GET /api/courses/categories/all',
        createWithContent: 'POST /api/courses/create-with-content'
      },
      admin: {
        stats: 'GET /api/admin/stats',
        users: 'GET /api/admin/users',
        courses: 'GET /api/admin/courses',
        approveCourse: 'PUT /api/admin/courses/:courseId/approve',
        deleteCourse: 'DELETE /api/admin/courses/:courseId',
        applications: 'GET /api/admin/applications/pending',
        sellerApplications: 'GET /api/admin/seller-applications'
      },
      community: {
        posts: 'GET /api/community/posts',
        createPost: 'POST /api/community/posts',
        likePost: 'POST /api/community/posts/:id/like',
        groups: 'GET /api/community/groups',
        joinGroup: 'POST /api/community/groups/:id/join',
        leaveGroup: 'POST /api/community/groups/:id/leave',
        messages: 'GET /api/community/messages',
        contributors: 'GET /api/community/contributors',
        events: 'GET /api/community/events',
        attendEvent: 'POST /api/community/events/:id/attend'
      },
      friends: {
        list: 'GET /api/friends/list',
        requests: 'GET /api/friends/requests',
        sendRequest: 'POST /api/friends/request',
        acceptRequest: 'PUT /api/friends/request/:id/accept',
        rejectRequest: 'PUT /api/friends/request/:id/reject',
        people: 'GET /api/friends/people'
      },
      messages: {
        send: 'POST /api/messages/send',
        conversation: 'GET /api/messages/conversation/:userId',
        conversations: 'GET /api/messages/conversations',
        markRead: 'PUT /api/messages/:messageId/read',
        unreadCount: 'GET /api/messages/unread/count'
      },
      payment: {
        initialize: 'POST /api/payment/initialize',
        verify: 'GET /api/payment/verify',
        myCourses: 'GET /api/payment/my-courses'
      },
      seller: {
        apply: 'POST /api/seller/apply',
        verifyPayment: 'GET /api/seller/verify-application-payment',
        myApplication: 'GET /api/seller/my-application',
        profile: 'POST /api/seller/profile',
        updateProfile: 'PUT /api/seller/profile',
        getProfile: 'GET /api/seller/profile/:userId',
        myProducts: 'GET /api/seller/my-products',
        products: 'GET /api/seller/products',
        createProduct: 'POST /api/seller/products',
        updateProduct: 'PUT /api/seller/products/:id',
        deleteProduct: 'DELETE /api/seller/products/:id'
      },
      health: 'GET /api/health',
      uploads: {
        test: 'GET /test-uploads',
        files: 'GET /uploads/:filename'
      }
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Study-Mart API is healthy',
    timestamp: new Date().toISOString()
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableEndpoints: '/'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🚀 Study-Mart Server Started Successfully!');
  console.log('='.repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log(`📁 Uploads folder: ${uploadsDir}`);
  console.log(`📁 Community uploads: ${communityUploadsDir}`);
  console.log(`📁 Product uploads: ${productUploadsDir}`);
  console.log(`🔗 API URL: http://localhost:${PORT}`);
  console.log(`🔗 Test uploads: http://localhost:${PORT}/test-uploads`);
  console.log('='.repeat(50) + '\n');

  console.log('📚 Available Routes:');
  console.log('   GET  / - API Info');
  console.log('   GET  /api/health - Health check');
  console.log('   GET  /test-uploads - Check uploads folder');
  console.log('   POST /api/auth/signup - Register user');
  console.log('   POST /api/auth/signin - Login user');
  console.log('   GET  /api/friends/people - Get all people');
  console.log('   GET  /api/messages/conversations - Get conversations');
  console.log('='.repeat(50) + '\n');
});