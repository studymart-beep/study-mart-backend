const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes working' });
});

// Sign Up
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields are required' 
      });
    }

    console.log('Creating user:', { email, fullName, role });

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    console.log('User created in auth:', authData.user.id);

    const userRole = role || 'student';

    const { error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: authData.user.id,
          full_name: fullName,
          role: userRole,
          is_approved: userRole === 'admin' ? true : false
        }
      ]);

    if (profileError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }

    console.log('Profile created successfully with role:', userRole);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        fullName: fullName,
        role: userRole
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Sign In - UPDATED VERSION
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password are required' 
      });
    }

    console.log('Signin attempt:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    console.log('Signin successful, getting profile...');

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      console.log('Profile fetch error:', profileError);
    }

    // IMPORTANT: Log the role being returned
    console.log('User role from database:', profile?.role);
    console.log('Sending role to frontend:', profile?.role);

    res.json({
      success: true,
      message: 'Signed in successfully',
      session: {
        access_token: data.session.access_token,
        expires_at: data.session.expires_at
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        profile: profile
      }
    });

  } catch (error) {
    console.error('Signin error:', error);
    res.status(401).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Sign Out
router.post('/signout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    res.json({ success: true, message: 'Signed out successfully' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        profile: profile
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;