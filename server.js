const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
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
app.use('/api/users', userRoutes);
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
  res.json({ message: 'Study Mart Backend API', status: 'active' });
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
});