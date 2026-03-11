const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const Paystack = require('paystack-api')(process.env.PAYSTACK_SECRET_KEY);

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

// Initialize payment for a course
router.post('/initialize', verifyToken, async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: 'Course ID required' });

    // Fetch course details
    const { data: course, error } = await supabase
      .from('courses')
      .select('title, price, instructor_id')
      .eq('id', courseId)
      .single();
    if (error) throw error;

    // Create Paystack transaction
    const response = await Paystack.transaction.initialize({
      email: req.user.email,
      amount: course.price * 100, // Paystack uses kobo (multiply by 100)
      metadata: {
        courseId,
        userId: req.user.id,
        instructorId: course.instructor_id
      },
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/verify`
    });

    res.json({ 
      success: true, 
      authorization_url: response.data.authorization_url,
      reference: response.data.reference
    });
  } catch (error) {
    console.error('Payment initialization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize payment for a product (with seller split)
router.post('/initialize-product', verifyToken, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId) return res.status(400).json({ error: 'Product ID required' });

    // Fetch product details with seller info
    const { data: product, error } = await supabase
      .from('products')
      .select(`
        *,
        seller:seller_id (
          business_name,
          paystack_subaccount_code
        )
      `)
      .eq('id', productId)
      .single();
    if (error) throw error;

    // Check if seller has subaccount for split payments
    if (!product.seller?.paystack_subaccount_code) {
      return res.status(400).json({ error: 'Seller payment configuration not found' });
    }

    const totalAmount = product.price * quantity * 100; // Convert to kobo

    // Create Paystack transaction with split
    const response = await Paystack.transaction.initialize({
      email: req.user.email,
      amount: totalAmount,
      metadata: {
        productId,
        userId: req.user.id,
        sellerId: product.seller_id,
        quantity,
        type: 'product_purchase'
      },
      subaccount: product.seller.paystack_subaccount_code,
      // 95% to seller (platform keeps 5%)
      transaction_charge: Math.floor(totalAmount * 0.05), // 5% platform fee in kobo
      bearer: 'subaccount', // Fee borne by seller
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/product-verify`
    });

    res.json({ 
      success: true, 
      authorization_url: response.data.authorization_url,
      reference: response.data.reference
    });
  } catch (error) {
    console.error('Product payment initialization error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify course payment and enroll student
router.get('/verify', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    // Verify with Paystack
    const response = await Paystack.transaction.verify({ reference });
    const { status, metadata, amount } = response.data;

    if (status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const { courseId, userId, instructorId } = metadata;

    // Check if already enrolled
    const { data: existing } = await supabase
      .from('enrollments')
      .select()
      .eq('student_id', userId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (existing) {
      return res.json({ success: true, message: 'Already enrolled' });
    }

    // Create enrollment
    const { error: enrollError } = await supabase
      .from('enrollments')
      .insert([{
        student_id: userId,
        course_id: courseId,
        enrolled_at: new Date(),
        progress: 0
      }]);
    if (enrollError) throw enrollError;

    // Record payment
    const { error: paymentError } = await supabase
      .from('payments')
      .insert([{
        student_id: userId,
        instructor_id: instructorId,
        course_id: courseId,
        amount: amount / 100,
        platform_fee: amount * 0.05 / 100, // 5% platform fee
        instructor_earnings: amount * 0.95 / 100,
        status: 'completed',
        paystack_reference: reference
      }]);
    if (paymentError) throw paymentError;

    res.json({ success: true, message: 'Enrollment successful' });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify product payment and create order
router.get('/product-verify', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    // Verify with Paystack
    const response = await Paystack.transaction.verify({ reference });
    const { status, metadata, amount } = response.data;

    if (status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const { productId, userId, sellerId, quantity } = metadata;

    // Get product details
    const { data: product } = await supabase
      .from('products')
      .select('price, stock_quantity')
      .eq('id', productId)
      .single();

    // Update stock quantity
    const newStock = product.stock_quantity - quantity;
    await supabase
      .from('products')
      .update({ 
        stock_quantity: newStock,
        status: newStock <= 0 ? 'out_of_stock' : 'active'
      })
      .eq('id', productId);

    // Create order record
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,
        product_id: productId,
        seller_id: sellerId,
        quantity,
        amount: amount / 100,
        platform_fee: amount * 0.05 / 100,
        seller_earnings: amount * 0.95 / 100,
        status: 'completed',
        payment_reference: reference
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    res.json({ 
      success: true, 
      message: 'Purchase successful',
      order 
    });
  } catch (error) {
    console.error('Product payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's purchased courses (for My Learning)
router.get('/my-courses', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select(`
        *,
        course:courses (*)
      `)
      .eq('student_id', req.user.id)
      .order('enrolled_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, courses: data });
  } catch (error) {
    console.error('Error fetching purchased courses:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's purchased products
router.get('/my-products', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        product:products (*)
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, orders: data });
  } catch (error) {
    console.error('Error fetching purchased products:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get seller's sales
router.get('/seller-sales', verifyToken, async (req, res) => {
  try {
    // Check if user is a seller
    const { data: seller } = await supabase
      .from('seller_profiles')
      .select('id')
      .eq('id', req.user.id)
      .single();

    if (!seller) {
      return res.status(403).json({ error: 'Not a seller' });
    }

    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        product:products (name, price),
        buyer:user_id (full_name, email)
      `)
      .eq('seller_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate totals
    const totalSales = data.reduce((sum, order) => sum + order.amount, 0);
    const totalFees = data.reduce((sum, order) => sum + order.platform_fee, 0);
    const totalEarnings = data.reduce((sum, order) => sum + order.seller_earnings, 0);

    res.json({ 
      success: true, 
      sales: data,
      summary: {
        totalSales,
        totalFees,
        totalEarnings,
        orderCount: data.length
      }
    });
  } catch (error) {
    console.error('Error fetching seller sales:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
router.get('/transactions', verifyToken, async (req, res) => {
  try {
    // Get both course enrollments and product orders
    const [courses, products] = await Promise.all([
      supabase
        .from('enrollments')
        .select(`
          *,
          course:courses (title)
        `)
        .eq('student_id', req.user.id),
      supabase
        .from('orders')
        .select(`
          *,
          product:products (name)
        `)
        .eq('user_id', req.user.id)
    ]);

    // Combine and format
    const courseTransactions = (courses.data || []).map(e => ({
      id: e.id,
      type: 'course',
      title: e.course?.title,
      amount: e.course?.price,
      date: e.enrolled_at,
      status: 'completed'
    }));

    const productTransactions = (products.data || []).map(o => ({
      id: o.id,
      type: 'product',
      title: o.product?.name,
      amount: o.amount,
      date: o.created_at,
      status: o.status
    }));

    const allTransactions = [...courseTransactions, ...productTransactions]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ 
      success: true, 
      transactions: allTransactions 
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get payment stats for admin
router.get('/admin/stats', verifyToken, async (req, res) => {
  try {
    // Check if admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get course payments
    const { data: coursePayments } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'completed');

    // Get product orders
    const { data: productOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'completed');

    const totalCourseRevenue = coursePayments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    const totalCourseFees = coursePayments?.reduce((sum, p) => sum + p.platform_fee, 0) || 0;
    
    const totalProductRevenue = productOrders?.reduce((sum, o) => sum + o.amount, 0) || 0;
    const totalProductFees = productOrders?.reduce((sum, o) => sum + o.platform_fee, 0) || 0;

    res.json({
      success: true,
      stats: {
        totalRevenue: totalCourseRevenue + totalProductRevenue,
        totalFees: totalCourseFees + totalProductFees,
        totalEarnings: (totalCourseRevenue - totalCourseFees) + (totalProductRevenue - totalProductFees),
        courseCount: coursePayments?.length || 0,
        productCount: productOrders?.length || 0
      }
    });
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'Payment routes are working' });
});

module.exports = router;