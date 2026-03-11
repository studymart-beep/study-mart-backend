const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

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

// Get user profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { full_name, bio, avatar_url } = req.body;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name,
        bio,
        avatar_url,
        updated_at: new Date()
      })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Apply to become an instructor
router.post('/apply-instructor', verifyToken, async (req, res) => {
  try {
    const { expertise_area, experience_years, sample_work_url } = req.body;

    // Check if already applied
    const { data: existing } = await supabase
      .from('instructor_applications')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (existing) {
      return res.status(400).json({ 
        error: 'You have already applied. Please wait for review.' 
      });
    }

    // Create application
    const { data, error } = await supabase
      .from('instructor_applications')
      .insert([
        {
          user_id: req.user.id,
          expertise_area,
          experience_years,
          sample_work_url,
          status: 'pending'
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get instructor application status
router.get('/application-status', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('instructor_applications')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      throw error;
    }

    res.json({
      success: true,
      application: data || null
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all instructors (public)
router.get('/instructors', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, bio, expertise')
      .eq('role', 'instructor')
      .eq('is_approved', true);

    if (error) throw error;

    res.json({
      success: true,
      instructors: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;