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
    
    // Get total users
    const { count: totalUsers, error: usersError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Get total courses
    const { count: totalCourses, error: coursesError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    // Get pending instructor applications
    const { count: pendingInstructors, error: pendingError } = await supabase
      .from('instructor_applications')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Get pending course approvals
    const { count: pendingCourses, error: pendingCoursesError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Get published courses
    const { count: publishedCourses, error: publishedError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published');

    console.log('📊 Stats:', {
      totalUsers,
      totalCourses,
      pendingInstructors,
      pendingCourses,
      publishedCourses
    });

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

// Get ALL courses for admin (UNFILTERED - shows everything)
router.get('/courses', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('🔍 Admin fetching ALL courses...');
    console.log('👤 Admin user ID:', req.user.id);
    
    // First, check if any courses exist at all
    const { count: totalCount, error: countError } = await supabase
      .from('courses')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 Total courses in database: ${totalCount || 0}`);

    if (countError) {
      console.error('❌ Error counting courses:', countError);
    }

    // Fetch all courses with related data
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

    if (error) {
      console.error('❌ Database error:', error);
      throw error;
    }

    console.log(`📚 Found ${data?.length || 0} courses total`);
    
    if (data && data.length > 0) {
      console.log('📋 First course:', {
        id: data[0].id,
        title: data[0].title,
        status: data[0].status,
        instructor: data[0].profiles?.full_name
      });
    } else {
      console.log('⚠️ No courses found in database');
    }

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
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete course with file cleanup
router.delete('/courses/:courseId', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;

    console.log(`🗑️ Deleting course: ${courseId}`);

    // First, get course details
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('title')
      .eq('id', courseId)
      .single();

    if (courseError) {
      console.error('❌ Error finding course:', courseError);
    } else {
      console.log(`📚 Deleting course: ${course.title}`);
    }

    // Get all associated files to delete them
    const [videos, pdfs] = await Promise.all([
      supabase.from('course_videos').select('file_name').eq('course_id', courseId),
      supabase.from('course_pdfs').select('file_name').eq('course_id', courseId)
    ]);

    // Delete video files from filesystem
    if (videos.data && videos.data.length > 0) {
      console.log(`🎬 Deleting ${videos.data.length} video files...`);
      for (const video of videos.data) {
        if (video.file_name) {
          const filePath = path.join(__dirname, '../uploads', video.file_name);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`✅ Deleted video file: ${video.file_name}`);
            }
          } catch (fileErr) {
            console.error(`❌ Error deleting video file: ${video.file_name}`, fileErr);
          }
        }
      }
    }

    // Delete PDF files from filesystem
    if (pdfs.data && pdfs.data.length > 0) {
      console.log(`📄 Deleting ${pdfs.data.length} PDF files...`);
      for (const pdf of pdfs.data) {
        if (pdf.file_name) {
          const filePath = path.join(__dirname, '../uploads', pdf.file_name);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`✅ Deleted PDF file: ${pdf.file_name}`);
            }
          } catch (fileErr) {
            console.error(`❌ Error deleting PDF file: ${pdf.file_name}`, fileErr);
          }
        }
      }
    }

    // Delete course (this will cascade delete videos, pdfs, qas due to foreign key constraints)
    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) {
      console.error('❌ Error deleting course from database:', error);
      throw error;
    }

    console.log(`✅ Course ${courseId} deleted successfully`);

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting course:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Approve or reject course
router.put('/courses/:courseId/approve', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { status } = req.body;

    console.log(`📝 Updating course ${courseId} to status: ${status}`);

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

    console.log(`✅ Course ${courseId} ${status} successfully`);

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
    console.log('👥 Fetching all users...');
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`👥 Found ${data?.length || 0} users`);

    res.json({
      success: true,
      users: data
    });
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update user role
router.put('/users/:userId', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, is_approved } = req.body;

    console.log(`👤 Updating user ${userId} to role: ${role}`);

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

    console.log(`✅ User ${userId} updated successfully`);

    res.json({
      success: true,
      message: 'User updated successfully',
      user: data
    });
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get pending instructor applications
router.get('/applications/pending', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('📝 Fetching pending applications...');
    
    const { data, error } = await supabase
      .from('instructor_applications')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`📝 Found ${data?.length || 0} pending applications`);

    res.json({
      success: true,
      applications: data
    });
  } catch (error) {
    console.error('❌ Error fetching applications:', error);
    res.status(400).json({ error: error.message });
  }
});

// Approve or reject instructor application
router.put('/applications/:applicationId', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status } = req.body;

    console.log(`📝 Updating application ${applicationId} to: ${status}`);

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get application details
    const { data: application, error: fetchError } = await supabase
      .from('instructor_applications')
      .select('user_id')
      .eq('id', applicationId)
      .single();

    if (fetchError) throw fetchError;

    // Update application status
    const { data, error } = await supabase
      .from('instructor_applications')
      .update({
        status: status,
        reviewed_by: req.user.id,
        reviewed_at: new Date()
      })
      .eq('id', applicationId)
      .select()
      .single();

    if (error) throw error;

    // If approved, update user profile to instructor
    if (status === 'approved') {
      console.log(`✅ Approving user ${application.user_id} as instructor`);
      await supabase
        .from('profiles')
        .update({
          role: 'instructor',
          is_approved: true,
          updated_at: new Date()
        })
        .eq('id', application.user_id);
    }

    console.log(`✅ Application ${applicationId} ${status} successfully`);

    res.json({
      success: true,
      message: `Application ${status} successfully`,
      application: data
    });
  } catch (error) {
    console.error('❌ Error updating application:', error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== SELLER APPLICATION ROUTES ====================

// Get all seller applications
router.get('/seller-applications', verifyToken, checkAdmin, async (req, res) => {
  try {
    console.log('👥 Fetching seller applications...');
    
    const { data, error } = await supabase
      .from('seller_applications')
      .select(`
        *,
        user:user_id (id, email, full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`📝 Found ${data?.length || 0} seller applications`);

    res.json({
      success: true,
      applications: data || []
    });
  } catch (error) {
    console.error('❌ Error fetching seller applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve seller application
router.post('/seller-applications/:id/approve', verifyToken, checkAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subaccount_code } = req.body;

    console.log(`✅ Approving seller application ${id} with subaccount: ${subaccount_code}`);

    if (!subaccount_code) {
      return res.status(400).json({ error: 'Subaccount code is required' });
    }

    // Get application details
    const { data: app, error: appError } = await supabase
      .from('seller_applications')
      .select('*')
      .eq('id', id)
      .single();

    if (appError) {
      console.error('❌ Error fetching application:', appError);
      throw appError;
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

    // Create seller profile with subaccount
    const { error: profileError } = await supabase
      .from('seller_profiles')
      .insert([{
        id: app.user_id,
        business_name: app.business_name,
        category: app.category,
        location: app.location,
        paystack_subaccount_code: subaccount_code
      }]);

    if (profileError) {
      console.error('❌ Error creating seller profile:', profileError);
      throw profileError;
    }

    console.log(`✅ Seller application ${id} approved and profile created`);

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

    console.log(`❌ Rejecting seller application ${id}`);

    const { error } = await supabase
      .from('seller_applications')
      .update({
        status: 'rejected',
        reviewed_at: new Date(),
        reviewed_by: req.user.id
      })
      .eq('id', id);

    if (error) throw error;

    console.log(`✅ Seller application ${id} rejected`);

    res.json({
      success: true,
      message: 'Application rejected'
    });
  } catch (error) {
    console.error('❌ Error rejecting seller application:', error);
    res.status(500).json({ error: error.message });
  }
});

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

    // Calculate summary
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
    console.error('❌ Error fetching revenue reports:', error);
    res.status(400).json({ error: error.message });
  }
});

// Create admin user (first run only)
router.post('/setup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // Create admin profile
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
    console.error('❌ Error creating admin:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;