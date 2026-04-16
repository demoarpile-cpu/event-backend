const express = require('express');
const prisma = require('../../config/db');
const { requireAuth, requireRole } = require('../../middlewares/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/blogs
 * @desc  Get all blogs for management
 */
router.get('/', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(blogs);
    } catch (error) {
        console.error('Error fetching admin blogs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route POST /api/admin/blogs
 * @desc  Create a new blog post
 */
router.post('/', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const { title, slug, featuredImage, shortDescription, content, authorName, status, metaTitle, metaDescription } = req.body;
        
        if (!title || !slug || !content) {
            return res.status(400).json({ error: 'Title, slug, and content are required' });
        }

        const blog = await prisma.blog.create({
            data: {
                title,
                slug,
                featuredImage,
                shortDescription,
                content,
                authorName,
                status: status || 'DRAFT',
                metaTitle,
                metaDescription,
                publishedAt: status === 'PUBLISHED' ? new Date() : null
            }
        });
        res.status(201).json(blog);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'A blog with this slug already exists' });
        }
        console.error('Error creating blog:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/blogs/:id
 * @desc  Get a single blog by ID
 */
router.get('/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const blog = await prisma.blog.findUnique({
            where: { id }
        });
        if (!blog) return res.status(404).json({ error: 'Blog not found' });
        res.json(blog);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PUT /api/admin/blogs/:id
 * @desc  Update an existing blog post
 */
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { title, slug, featuredImage, shortDescription, content, authorName, status, metaTitle, metaDescription } = req.body;

        const existingBlog = await prisma.blog.findUnique({ where: { id } });
        if (!existingBlog) return res.status(404).json({ error: 'Blog not found' });

        let publishedAt = existingBlog.publishedAt;
        if (status === 'PUBLISHED' && existingBlog.status !== 'PUBLISHED') {
            publishedAt = new Date();
        }

        const blog = await prisma.blog.update({
            where: { id },
            data: {
                title,
                slug,
                featuredImage,
                shortDescription,
                content,
                authorName,
                status,
                metaTitle,
                metaDescription,
                publishedAt
            }
        });
        res.json(blog);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'A blog with this slug already exists' });
        }
        console.error('Error updating blog:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route DELETE /api/admin/blogs/:id
 * @desc  Delete a blog post
 */
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await prisma.blog.delete({
            where: { id }
        });
        res.json({ message: 'Blog deleted successfully' });
    } catch (error) {
        console.error('Error deleting blog:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
