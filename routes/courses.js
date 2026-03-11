const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Uploads directory created at:', uploadDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only video and PDF files are allowed'));
    }
  }
});

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

// Middleware to check if user is instructor/admin
const checkInstructor = async (req, res, next) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, is_approved')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    if (profile.role !== 'instructor' && profile.role !== 'admin') {
      return res.status(403).json({ 
        error: 'You must be an instructor or admin to perform this action' 
      });
    }

    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get all published courses (public)
router.get('/', async (req, res) => {
  try {
    const { category, level, search } = req.query;
    
    let query = supabase
      .from('courses')
      .select(`
        *,
        profiles:instructor_id (
          full_name,
          avatar_url
        ),
        categories (
          name
        )
      `)
      .eq('status', 'published');

    if (category) {
      query = query.eq('category_id', category);
    }
    if (level) {
      query = query.eq('level', level);
    }
    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Get content counts for each course
    for (let course of data) {
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
      courses: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get instructor's courses (protected)
router.get('/instructor/my-courses', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('courses')
      .select(`
        *,
        lessons (count)
      `)
      .eq('instructor_id', req.user.id);

    if (error) throw error;

    res.json({
      success: true,
      courses: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get single course with content (public for published, protected for others)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get course details
    const { data: course, error } = await supabase
      .from('courses')
      .select(`
        *,
        profiles:instructor_id (
          full_name,
          avatar_url,
          bio
        ),
        categories (
          name
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    // Check if course is published or user has access
    if (course.status !== 'published') {
      // Check if user is authenticated and is the instructor or admin
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', user.id)
              .single();
            
            if (course.instructor_id !== user.id && profile?.role !== 'admin') {
              return res.status(403).json({ error: 'Course not published' });
            }
          } else {
            return res.status(403).json({ error: 'Course not published' });
          }
        } catch {
          return res.status(403).json({ error: 'Course not published' });
        }
      } else {
        return res.status(403).json({ error: 'Course not published' });
      }
    }

    // Get course content
    const [videos, pdfs, qas] = await Promise.all([
      supabase.from('course_videos').select('*').eq('course_id', id).order('order_index'),
      supabase.from('course_pdfs').select('*').eq('course_id', id).order('order_index'),
      supabase.from('course_qas').select('*').eq('course_id', id).order('created_at')
    ]);

    res.json({
      success: true,
      course: {
        ...course,
        videos: videos.data || [],
        pdfs: pdfs.data || [],
        qas: qas.data || []
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get course content for editing (admin/instructor only)
router.get('/:id/content', verifyToken, checkInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user owns the course or is admin
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', id)
      .single();

    if (courseError) throw courseError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get course content
    const [videos, pdfs, qas] = await Promise.all([
      supabase.from('course_videos').select('*').eq('course_id', id).order('order_index'),
      supabase.from('course_pdfs').select('*').eq('course_id', id).order('order_index'),
      supabase.from('course_qas').select('*').eq('course_id', id).order('created_at')
    ]);

    res.json({
      success: true,
      content: {
        videos: videos.data || [],
        pdfs: pdfs.data || [],
        qas: qas.data || []
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create a new course (basic info only)
router.post('/', verifyToken, checkInstructor, async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      category_id,
      level,
      thumbnail_url
    } = req.body;

    if (!title || !description || !price || !category_id) {
      return res.status(400).json({ 
        error: 'Title, description, price, and category are required' 
      });
    }

    const { data, error } = await supabase
      .from('courses')
      .insert([
        {
          title,
          description,
          price: parseFloat(price),
          category_id: parseInt(category_id),
          level: level || 'beginner',
          instructor_id: req.user.id,
          thumbnail_url,
          status: 'draft'
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      course: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create course with content (videos, PDFs, Q&A)
router.post('/create-with-content', verifyToken, checkInstructor, upload.fields([
  { name: 'videos', maxCount: 10 },
  { name: 'pdfs', maxCount: 10 }
]), async (req, res) => {
  try {
    const { title, description, price, category_id, level, thumbnail_url, status, qas } = req.body;
    const videoFiles = req.files?.videos || [];
    const pdfFiles = req.files?.pdfs || [];
    const parsedQAs = JSON.parse(qas || '[]');

    console.log('Creating course:', { title, price, status });
    console.log('Videos:', videoFiles.length);
    console.log('PDFs:', pdfFiles.length);
    console.log('Q&As:', parsedQAs.length);

    // Create course
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .insert([
        {
          title,
          description,
          price: parseFloat(price),
          category_id: parseInt(category_id),
          level,
          thumbnail_url,
          instructor_id: req.user.id,
          status: status || 'draft'
        }
      ])
      .select()
      .single();

    if (courseError) {
      console.error('Course creation error:', courseError);
      throw courseError;
    }

    console.log('Course created with ID:', course.id);

    // Save videos
    for (let i = 0; i < videoFiles.length; i++) {
      const video = videoFiles[i];
      const fileUrl = `/uploads/${video.filename}`;
      
      console.log('Saving video:', video.originalname, 'at path:', fileUrl);
      
      const { error: videoError } = await supabase
        .from('course_videos')
        .insert([
          {
            course_id: course.id,
            title: video.originalname,
            file_path: fileUrl,
            file_name: video.filename,
            file_size: video.size,
            mime_type: video.mimetype,
            order_index: i,
            duration: 0
          }
        ]);

      if (videoError) {
        console.error('Video save error:', videoError);
        throw videoError;
      }
    }

    // Save PDFs
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdf = pdfFiles[i];
      const fileUrl = `/uploads/${pdf.filename}`;
      
      console.log('Saving PDF:', pdf.originalname, 'at path:', fileUrl);
      
      const { error: pdfError } = await supabase
        .from('course_pdfs')
        .insert([
          {
            course_id: course.id,
            title: pdf.originalname,
            file_path: fileUrl,
            file_name: pdf.filename,
            file_size: pdf.size,
            mime_type: pdf.mimetype,
            order_index: i
          }
        ]);

      if (pdfError) {
        console.error('PDF save error:', pdfError);
        throw pdfError;
      }
    }

    // Save Q&As
    for (let i = 0; i < parsedQAs.length; i++) {
      const qa = parsedQAs[i];
      if (qa.question && qa.answer) {
        const { error: qaError } = await supabase
          .from('course_qas')
          .insert([
            {
              course_id: course.id,
              question: qa.question,
              answer: qa.answer,
              order_index: i
            }
          ]);

        if (qaError) {
          console.error('QA save error:', qaError);
          throw qaError;
        }
      }
    }

    res.json({
      success: true,
      message: 'Course created successfully',
      course: course
    });

  } catch (error) {
    console.error('Course creation error:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Update course
router.put('/:id', verifyToken, checkInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if user owns the course
    const { data: course, error: checkError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', id)
      .single();

    if (checkError) throw checkError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('courses')
      .update({
        ...updates,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Course updated successfully',
      course: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update course with content
router.put('/:id/update-with-content', verifyToken, checkInstructor, upload.fields([
  { name: 'videos', maxCount: 10 },
  { name: 'pdfs', maxCount: 10 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, category_id, level, thumbnail_url, status, qas } = req.body;
    const videoFiles = req.files?.videos || [];
    const pdfFiles = req.files?.pdfs || [];
    const parsedQAs = JSON.parse(qas || '[]');

    // Check if user owns the course
    const { data: course, error: checkError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', id)
      .single();

    if (checkError) throw checkError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update course basic info
    const { error: updateError } = await supabase
      .from('courses')
      .update({
        title,
        description,
        price: parseFloat(price),
        category_id: parseInt(category_id),
        level,
        thumbnail_url,
        status,
        updated_at: new Date()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Add new videos
    for (let i = 0; i < videoFiles.length; i++) {
      const video = videoFiles[i];
      const fileUrl = `/uploads/${video.filename}`;
      
      const { error: videoError } = await supabase
        .from('course_videos')
        .insert([
          {
            course_id: id,
            title: video.originalname,
            file_path: fileUrl,
            file_name: video.filename,
            file_size: video.size,
            mime_type: video.mimetype,
            order_index: i
          }
        ]);

      if (videoError) throw videoError;
    }

    // Add new PDFs
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdf = pdfFiles[i];
      const fileUrl = `/uploads/${pdf.filename}`;
      
      const { error: pdfError } = await supabase
        .from('course_pdfs')
        .insert([
          {
            course_id: id,
            title: pdf.originalname,
            file_path: fileUrl,
            file_name: pdf.filename,
            file_size: pdf.size,
            mime_type: pdf.mimetype,
            order_index: i
          }
        ]);

      if (pdfError) throw pdfError;
    }

    // Delete existing Q&As and add new ones
    await supabase.from('course_qas').delete().eq('course_id', id);
    
    for (let i = 0; i < parsedQAs.length; i++) {
      const qa = parsedQAs[i];
      if (qa.question && qa.answer) {
        const { error: qaError } = await supabase
          .from('course_qas')
          .insert([
            {
              course_id: id,
              question: qa.question,
              answer: qa.answer,
              order_index: i
            }
          ]);

        if (qaError) throw qaError;
      }
    }

    res.json({
      success: true,
      message: 'Course updated successfully'
    });

  } catch (error) {
    console.error('Course update error:', error);
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Delete video from course
router.delete('/:courseId/videos/:videoId', verifyToken, checkInstructor, async (req, res) => {
  try {
    const { courseId, videoId } = req.params;

    // Check if user owns the course
    const { data: course, error: checkError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', courseId)
      .single();

    if (checkError) throw checkError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get video info to delete file
    const { data: video } = await supabase
      .from('course_videos')
      .select('file_name')
      .eq('id', videoId)
      .single();

    if (video && video.file_name) {
      const filePath = path.join(uploadDir, video.file_name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete from database
    const { error } = await supabase
      .from('course_videos')
      .delete()
      .eq('id', videoId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete PDF from course
router.delete('/:courseId/pdfs/:pdfId', verifyToken, checkInstructor, async (req, res) => {
  try {
    const { courseId, pdfId } = req.params;

    // Check if user owns the course
    const { data: course, error: checkError } = await supabase
      .from('courses')
      .select('instructor_id')
      .eq('id', courseId)
      .single();

    if (checkError) throw checkError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get PDF info to delete file
    const { data: pdf } = await supabase
      .from('course_pdfs')
      .select('file_name')
      .eq('id', pdfId)
      .single();

    if (pdf && pdf.file_name) {
      const filePath = path.join(uploadDir, pdf.file_name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete from database
    const { error } = await supabase
      .from('course_pdfs')
      .delete()
      .eq('id', pdfId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'PDF deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Submit course for approval
router.post('/:id/submit', verifyToken, checkInstructor, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: course, error: checkError } = await supabase
      .from('courses')
      .select('instructor_id, status')
      .eq('id', id)
      .single();

    if (checkError) throw checkError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (course.instructor_id !== req.user.id && profile.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('courses')
      .update({
        status: 'pending',
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Course submitted for approval',
      course: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all categories
router.get('/categories/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name');

    if (error) throw error;

    res.json({
      success: true,
      categories: data
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;