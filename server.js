// In server.js, make sure you have:

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