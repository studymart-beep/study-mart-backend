const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const Paystack = require('paystack-api')(process.env.PAYSTACK_SECRET_KEY);
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Setup multer for product images
const uploadDir = path.join(__dirname, '../uploads/products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Verify token middleware
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

// Apply for seller
router.post('/apply', verifyToken, async (req, res) => {
  try {
    const { full_name, business_name, category, location, payment_details } = req.body;
    if (!full_name || !business_name || !category || !location || !payment_details) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if already applied
    const { data: existing } = await supabase
      .from('seller_applications')
      .select()
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ error: 'You have already applied' });
    }

    // Create application (pending payment)
    const { data, error } = await supabase
      .from('seller_applications')
      .insert([{
        user_id: req.user.id,
        full_name,
        business_name,
        category,
        location,
        payment_details,
        status: 'pending',
        fee_paid: false
      }])
      .select()
      .single();
    if (error) throw error;

    // Initialize payment for application fee (1000 NGN)
    const response = await Paystack.transaction.initialize({
      email: req.user.email,
      amount: 1000 * 100,
      metadata: {
        application_id: data.id,
        user_id: req.user.id,
        type: 'seller_application_fee'
      },
      callback_url: `${process.env.FRONTEND_URL}/seller/application/payment-callback`
    });

    res.json({
      success: true,
      application: data,
      authorization_url: response.data.authorization_url,
      reference: response.data.reference
    });
  } catch (error) {
    console.error('Seller application error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify application fee payment
router.get('/verify-application-payment', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    const response = await Paystack.transaction.verify({ reference });
    const { status, metadata } = response.data;
    if (status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const { application_id } = metadata;
    const { error } = await supabase
      .from('seller_applications')
      .update({ fee_paid: true, payment_reference: reference })
      .eq('id', application_id);
    if (error) throw error;

    res.json({ success: true, message: 'Payment verified' });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's application status
router.get('/my-application', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seller_applications')
      .select()
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, application: data });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create seller profile (after approval)
router.post('/profile', verifyToken, async (req, res) => {
  try {
    const { business_name, category, location } = req.body;
    if (!business_name || !category || !location) {
      return res.status(400).json({ error: 'All fields required' });
    }

    // Check if user is approved seller (must have an approved application)
    const { data: application } = await supabase
      .from('seller_applications')
      .select()
      .eq('user_id', req.user.id)
      .eq('status', 'approved')
      .single();
    if (!application) {
      return res.status(403).json({ error: 'Not approved as seller' });
    }

    // Insert seller profile
    const { data, error } = await supabase
      .from('seller_profiles')
      .insert([{
        id: req.user.id,
        business_name,
        category,
        location
      }])
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, profile: data });
  } catch (error) {
    console.error('Error creating seller profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update seller profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { business_name, category, location } = req.body;
    const { data, error } = await supabase
      .from('seller_profiles')
      .update({ business_name, category, location, updated_at: new Date() })
      .eq('id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get seller profile (public)
router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('seller_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get seller's own products (for seller dashboard)
router.get('/my-products', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        images:product_images (image_url, is_primary)
      `)
      .eq('seller_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, products: data });
  } catch (error) {
    console.error('Error fetching seller products:', error);
    res.status(500).json({ error: error.message });
  }
});

// Product management
router.post('/products', verifyToken, upload.array('images', 5), async (req, res) => {
  try {
    const { name, description, price, category, stock } = req.body;
    if (!name || !price || !category) {
      return res.status(400).json({ error: 'Name, price, category required' });
    }

    // Check if seller profile exists
    const { data: profile } = await supabase
      .from('seller_profiles')
      .select()
      .eq('id', req.user.id)
      .single();
    if (!profile) {
      return res.status(403).json({ error: 'Seller profile not found' });
    }

    // Insert product
    const { data: product, error } = await supabase
      .from('products')
      .insert([{
        seller_id: req.user.id,
        name,
        description,
        price: parseFloat(price),
        category,
        stock_quantity: stock ? parseInt(stock) : 0,
        status: 'active'
      }])
      .select()
      .single();
    if (error) throw error;

    // Save images
    if (req.files && req.files.length > 0) {
      const images = req.files.map((file, index) => ({
        product_id: product.id,
        image_url: `/uploads/products/${file.filename}`,
        is_primary: index === 0
      }));
      const { error: imgError } = await supabase
        .from('product_images')
        .insert(images);
      if (imgError) throw imgError;
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all products (for marketplace)
router.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        seller:seller_id (business_name, category),
        images:product_images (image_url, is_primary)
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, products: data });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single product
router.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        seller:seller_id (business_name, category, location),
        images:product_images (image_url, is_primary)
      `)
      .eq('id', id)
      .single();
    if (error) throw error;
    res.json({ success: true, product: data });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update product (seller only)
router.put('/products/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { data: product } = await supabase
      .from('products')
      .select('seller_id')
      .eq('id', id)
      .single();
    if (!product || product.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { data, error } = await supabase
      .from('products')
      .update({ ...updates, updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, product: data });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete product (seller only)
router.delete('/products/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: product } = await supabase
      .from('products')
      .select('seller_id')
      .eq('id', id)
      .single();
    if (!product || product.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await supabase.from('products').delete().eq('id', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;