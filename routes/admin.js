const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const fs = require('fs');
const path = require('path');

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware to check if user is admin
const checkAdmin = async (req, res, next) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    if (profile.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }

    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get dashboard statistics
router.get('/stats', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching admin stats...');
    
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: totalCourses } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    const { count: pendingInstructors } = await supabase
      .from('instructor_applications')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: pendingCourses } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: publishedCourses } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        totalCourses: totalCourses || 0,
        pendingInstructors: pendingInstructors || 0,
        pendingCourses: pendingCourses || 0,
        publishedCourses: publishedCourses || 0
      }
    });
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get ALL courses for admin
router.get('/courses', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('🔍 Admin fetching ALL courses...');
    
    const { data, error } = await supabase
      .from('courses')
      .select(`
        *,
        profiles:instructor_id (
          id,
          full_name,
          email
        ),
        categories (
          id,
          name
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get content counts for each course
    for (let course of data || []) {
      const [videos, pdfs, qas] = await Promise.all([
        supabase.from('course_videos').select('id', { count: 'exact', head: true }).eq('course_id', course.id),
        supabase.from('course_pdfs').select('id', { count: 'exact', head: true }).eq('course_id', course.id),
        supabase.from('course_qas').select('id', { count: 'exact', head: true }).eq('course_id', course.id)
      ]);
      
      course.video_count = videos.count || 0;
      course.pdf_count = pdfs.count || 0;
      course.qa_count = qas.count || 0;
    }

    res.json({
      success: true,
      courses: data || []
    });
  } catch (error) {
    console.error('❌ Error in /admin/courses:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete course with file cleanup
router.delete('/courses/:courseId', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;

    console.log(`🗑️ Deleting course: ${courseId}`);

    const [videos, pdfs] = await Promise.all([
      supabase.from('course_videos').select('file_name').eq('course_id', courseId),
      supabase.from('course_pdfs').select('file_name').eq('course_id', courseId)
    ]);

    // Delete video files
    if (videos.data && videos.data.length > 0) {
      for (const video of videos.data) {
        if (video.file_name) {
          const filePath = path.join(__dirname, '../uploads', video.file_name);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (fileErr) {
            console.error(`Error deleting video file: ${video.file_name}`, fileErr);
          }
        }
      }
    }

    // Delete PDF files
    if (pdfs.data && pdfs.data.length > 0) {
      for (const pdf of pdfs.data) {
        if (pdf.file_name) {
          const filePath = path.join(__dirname, '../uploads', pdf.file_name);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (fileErr) {
            console.error(`Error deleting PDF file: ${pdf.file_name}`, fileErr);
          }
        }
      }
    }

    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting course:', error);
    res.status(400).json({ error: error.message });
  }
});

// Approve or reject course
router.put('/courses/:courseId/approve', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { status } = req.body;

    if (!['published', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data, error } = await supabase
      .from('courses')
      .update({
        status: status,
        updated_at: new Date()
      })
      .eq('id', courseId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: `Course ${status === 'published' ? 'approved' : 'rejected'} successfully`,
      course: data
    });
  } catch (error) {
    console.error('❌ Error approving course:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get all users
router.get('/users', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      users: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update user role
router.put('/users/:userId', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, is_approved } = req.body;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        role: role,
        is_approved: is_approved,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'User updated successfully',
      user: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== SELLER APPLICATION ROUTES ====================

// Get all seller applications
router.get('/seller-applications', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('📝 Fetching all seller applications...');
    
    const { data, error } = await supabase
      .from('seller_applications')
      .select(`
        *,
        user:user_id (
          id,
          email,
          full_name,
          avatar_url,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      applications: data || []
    });
  } catch (error) {
    console.error('❌ Error fetching seller applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get seller application statistics
router.get('/seller-applications/stats', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching seller application stats...');
    
    const [pending, approved, rejected, total] = await Promise.all([
      supabase.from('seller_applications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('seller_applications').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('seller_applications').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabase.from('seller_applications').select('*', { count: 'exact', head: true })
    ]);

    res.json({
      success: true,
      stats: {
        pending: pending.count || 0,
        approved: approved.count || 0,
        rejected: rejected.count || 0,
        total: total.count || 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching seller stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single seller application
router.get('/seller-applications/:id', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('seller_applications')
      .select(`
        *,
        user:user_id (
          id,
          email,
          full_name,
          avatar_url,
          created_at
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      application: data
    });
  } catch (error) {
    console.error('❌ Error fetching application:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve seller application
router.post('/seller-applications/:id/approve', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subaccount_code } = req.body;

    console.log(`✅ Approving seller application ${id}`);

    if (!subaccount_code) {
      return res.status(400).json({ error: 'Subaccount code is required' });
    }

    // Get application details
    const { data: app, error: appError } = await supabase
      .from('seller_applications')
      .select('*')
      .eq('id', id)
      .single();

    if (appError) throw appError;

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (app.status !== 'pending') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    if (!app.fee_paid) {
      return res.status(400).json({ error: 'Application fee has not been paid' });
    }

    // Update application status
    const { error: updateError } = await supabase
      .from('seller_applications')
      .update({
        status: 'approved',
        reviewed_at: new Date(),
        reviewed_by: req.user.id
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Create seller profile
    const { error: profileError } = await supabase
      .from('seller_profiles')
      .insert([{
        id: app.user_id,
        business_name: app.business_name,
        category: app.category,
        location: app.location,
        paystack_subaccount_code: subaccount_code,
        created_at: new Date()
      }]);

    if (profileError) {
      // Rollback
      await supabase.from('seller_applications').update({ status: 'pending' }).eq('id', id);
      throw profileError;
    }

    // Update user role
    await supabase
      .from('profiles')
      .update({ role: 'seller' })
      .eq('id', app.user_id);

    // Create notification for the seller
    await supabase
      .from('notifications')
      .insert([{
        user_id: app.user_id,
        type: 'seller_approved',
        title: '🎉 Seller Application Approved!',
        message: `Congratulations! Your application to become a seller has been approved. You can now start adding products to the marketplace.`,
        data: { 
          application_id: id,
          business_name: app.business_name
        },
        read: false,
        created_at: new Date()
      }]);

    console.log(`✅ Seller application ${id} approved and notification sent`);

    res.json({
      success: true,
      message: 'Seller approved successfully'
    });
  } catch (error) {
    console.error('❌ Error approving seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reject seller application
router.post('/seller-applications/:id/reject', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    console.log(`❌ Rejecting seller application ${id}`);

    const { data: app, error: appError } = await supabase
      .from('seller_applications')
      .select('*')
      .eq('id', id)
      .single();

    if (appError) throw appError;

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (app.status !== 'pending') {
      return res.status(400).json({ error: 'Application is not pending' });
    }

    const { error } = await supabase
      .from('seller_applications')
      .update({
        status: 'rejected',
        rejection_reason: reason || 'Your application did not meet our requirements at this time.',
        reviewed_at: new Date(),
        reviewed_by: req.user.id
      })
      .eq('id', id);

    if (error) throw error;

    // Create notification for rejection
    await supabase
      .from('notifications')
      .insert([{
        user_id: app.user_id,
        type: 'seller_rejected',
        title: 'Seller Application Update',
        message: reason || 'Your seller application was not approved at this time.',
        data: { application_id: id },
        read: false,
        created_at: new Date()
      }]);

    res.json({
      success: true,
      message: 'Application rejected'
    });
  } catch (error) {
    console.error('❌ Error rejecting seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending seller applications
router.get('/seller-applications/pending', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seller_applications')
      .select(`
        *,
        user:user_id (
          id,
          email,
          full_name
        )
      `)
      .eq('status', 'pending')
      .eq('fee_paid', true)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      applications: data || []
    });
  } catch (error) {
    console.error('❌ Error fetching pending applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== NOTIFICATION ROUTES ====================

// Get user notifications
router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get unread count
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('read', false);

    res.json({
      success: true,
      notifications: data || [],
      unreadCount: count || 0
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mark all notifications as read
router.put('/notifications/read-all', verifyToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', req.user.id)
      .eq('read', false);

    if (error) throw error;

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REVENUE REPORTS ====================

// Get revenue reports
router.get('/reports/revenue', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = supabase
      .from('payments')
      .select(`
        *,
        profiles:student_id (full_name, email),
        courses:course_id (title)
      `)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (start_date) {
      query = query.gte('created_at', start_date);
    }
    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data, error } = await query;

    if (error) throw error;

    const summary = {
      totalRevenue: data.reduce((sum, p) => sum + (p.amount || 0), 0),
      totalFees: data.reduce((sum, p) => sum + (p.platform_fee || 0), 0),
      totalTransactions: data.length,
      averageTransactionValue: data.length > 0 
        ? data.reduce((sum, p) => sum + (p.amount || 0), 0) / data.length 
        : 0
    };

    res.json({
      success: true,
      summary,
      transactions: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create admin user (first run only)
router.post('/setup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    const { error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: authData.user.id,
          full_name: fullName,
          role: 'admin',
          is_approved: true
        }
      ]);

    if (profileError) throw profileError;

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;