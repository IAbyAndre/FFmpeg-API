const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

// Set ffmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const PORT = process.env.PORT || 3000;
// Support both variable names for backward compatibility/ease of use
const API_KEY = process.env.FFMPEG_APIKEY || process.env.API_KEY;

// Enable CORS for all routes
app.use(cors({
    allowedHeaders: ['Content-Type', 'ffmpeg-apikey', 'x-api-key'],
    origin: '*'
}));

// Authentication Middleware
const authenticateApiKey = (req, res, next) => {
    // Skip auth for OPTIONS requests (preflight)
    if (req.method === 'OPTIONS') return next();

    const apiKey = req.header('ffmpeg-apikey');
    
    // Debug logging (remove in production if sensitive)
    console.log(`[Auth] Received Key: ${apiKey ? '***' + apiKey.slice(-4) : 'None'} | Expected: ${API_KEY ? '***' + API_KEY.slice(-4) : 'None'}`);
    console.log(`[Auth] Full Env Check - FFMPEG_APIKEY: ${!!process.env.FFMPEG_APIKEY}, API_KEY: ${!!process.env.API_KEY}`);

    if (!API_KEY) {
        console.error('[Auth] Server API Key is not configured!');
        return res.status(500).json({ error: 'Server misconfiguration: API Key not set' });
    }

    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
};

// Swagger Configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'FFmpeg Video Processing API',
            version: '1.0.0',
            description: 'API for uploading, processing, stitching, and converting videos using FFmpeg',
        },
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'ffmpeg-apikey'
                }
            }
        },
        security: [{ ApiKeyAuth: [] }],
        servers: [
            {
                url: 'https://video.andre-ia.fr',
                description: 'Production Server',
            },
            {
                url: `http://localhost:${PORT}`,
                description: 'Local Development Server',
            },
        ],
    },
    apis: ['./server.js'], // Path to the API docs
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Apply authentication to all API routes
app.use('/api', authenticateApiKey);

// Ensure directories exist
const uploadDir = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'public/processed');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Sanitize filename: remove spaces and special chars
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, Date.now() + '-' + sanitized);
    }
});
const upload = multer({ storage });

app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // Serve uploads for preview
app.use(express.json());

// API: Upload Video
/**
 * @swagger
 * /api/upload:
 *   post:
 *     summary: Upload a video file
 *     description: |
 *       Upload a video file to the server.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const formData = new FormData();
 *       formData.append('video', fileInput.files[0]);
 *       
 *       const response = await fetch('https://video.andre-ia.fr/api/upload', {
 *         method: 'POST',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: formData
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Videos]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 filename:
 *                   type: string
 *                 originalName:
 *                   type: string
 *       400:
 *         description: No file uploaded
 */
app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filename: req.file.filename, originalName: req.file.originalname });
});

// API: List Videos
/**
 * @swagger
 * /api/videos:
 *   get:
 *     summary: List all uploaded and processed videos
 *     description: |
 *       Retrieve a list of all available video files (both uploaded and processed).
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const response = await fetch('https://video.andre-ia.fr/api/videos', {
 *         method: 'GET',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         }
 *       });
 *       const files = await response.json();
 *       console.log(files);
 *       ```
 *     tags: [Videos]
 *     responses:
 *       200:
 *         description: List of video files with metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   filename:
 *                     type: string
 *                   type:
 *                     type: string
 *                     enum: [upload, processed]
 *                   url:
 *                     type: string
 *       500:
 *         description: Server error
 */
app.get('/api/videos', async (req, res) => {
    try {
        const getFiles = async (dir, type, urlPrefix) => {
            try {
                const files = await fs.promises.readdir(dir);
                return files
                    .filter(f => f !== '.DS_Store')
                    .map(f => ({
                        filename: f,
                        type: type,
                        url: `${urlPrefix}/${f}`
                    }));
            } catch (e) {
                return [];
            }
        };

        const uploads = await getFiles(uploadDir, 'upload', '/uploads');
        const processed = await getFiles(processedDir, 'processed', '/processed');

        res.json([...uploads, ...processed]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to find file in uploads or processed
const findFilePath = (filename) => {
    const uploadPath = path.join(uploadDir, filename);
    if (fs.existsSync(uploadPath)) return uploadPath;
    
    const processedPath = path.join(processedDir, filename);
    if (fs.existsSync(processedPath)) return processedPath;
    
    return null;
};

// API: Delete Video
/**
 * @swagger
 * /api/videos/{filename}:
 *   delete:
 *     summary: Delete a video file (from uploads or processed)
 *     description: |
 *       Delete a specific video file by filename.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const filename = '1234567890-video.mp4';
 *       const response = await fetch(`https://video.andre-ia.fr/api/videos/${filename}`, {
 *         method: 'DELETE',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         }
 *       });
 *       const result = await response.json();
 *       console.log(result);
 *       ```
 *     tags: [Videos]
 *     parameters:
 *       - in: path
 *         name: filename
 *         schema:
 *           type: string
 *         required: true
 *         description: The filename of the video to delete
 *     responses:
 *       200:
 *         description: File deleted successfully
 *       404:
 *         description: File not found
 *       500:
 *         description: Failed to delete file
 */
app.delete('/api/videos/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = findFilePath(filename);

    if (!filePath) {
        return res.status(404).json({ error: 'File not found' });
    }

    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to delete file' });
        res.json({ success: true, message: 'File deleted successfully' });
    });
});

// API: Convert Video
/**
 * @swagger
 * /api/convert:
 *   post:
 *     summary: Convert a video to a different format
 *     description: |
 *       Convert a video file to a specified format (mp4, mov, avi, mp3, gif).
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const response = await fetch('https://video.andre-ia.fr/api/convert', {
 *         method: 'POST',
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: JSON.stringify({
 *           filename: '1234567890-video.mp4',
 *           format: 'gif'
 *         })
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *               format:
 *                 type: string
 *                 enum: [mp4, mov, avi, mp3, gif]
 *     responses:
 *       200:
 *         description: Conversion successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       404:
 *         description: File not found
 *       500:
 *         description: Conversion failed
 */
app.post('/api/convert', (req, res) => {
    const { filename, format } = req.body;
    const inputPath = findFilePath(filename);
    const outputFilename = `converted-${Date.now()}.${format}`;
    const outputPath = path.join(processedDir, outputFilename);

    if (!inputPath) return res.status(404).json({ error: 'File not found' });

    console.log(`Starting conversion: ${filename} -> ${format}`);

    ffmpeg(inputPath)
        .toFormat(format)
        .on('end', () => {
            console.log('Conversion finished');
            res.json({ success: true, downloadUrl: `/processed/${outputFilename}` });
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).json({ error: 'Conversion failed' });
        })
        .save(outputPath);
});

// API: Get Video Info
/**
 * @swagger
 * /api/info/{filename}:
 *   get:
 *     summary: Get metadata information about a video
 *     description: |
 *       Retrieve technical metadata (resolution, duration, codec, etc.) for a video file.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const filename = '1234567890-video.mp4';
 *       const response = await fetch(`https://video.andre-ia.fr/api/info/${filename}`, {
 *         method: 'GET',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         }
 *       });
 *       const metadata = await response.json();
 *       console.log(metadata);
 *       ```
 *     tags: [Videos]
 *     parameters:
 *       - in: path
 *         name: filename
 *         schema:
 *           type: string
 *         required: true
 *         description: The filename of the video
 *     responses:
 *       200:
 *         description: Video metadata
 *       500:
 *         description: Server error
 */
app.get('/api/info/:filename', (req, res) => {
    const inputPath = findFilePath(req.params.filename);
    if (!inputPath) return res.status(404).json({ error: 'File not found' });

    ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(metadata.format);
    });
});

// API: Stitch Videos
/**
 * @swagger
 * /api/stitch:
 *   post:
 *     summary: Stitch multiple videos together
 *     description: |
 *       Combine multiple video files into a single video.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const response = await fetch('https://video.andre-ia.fr/api/stitch', {
 *         method: 'POST',
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: JSON.stringify({
 *           videos: ['video1.mp4', 'video2.mp4'],
 *           mute: false,
 *           resolution: '1280:720',
 *           resizeMode: 'fit'
 *         })
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               videos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of filenames to stitch
 *               customAudio:
 *                 type: string
 *                 format: binary
 *                 description: Optional custom audio file
 *               mute:
 *                 type: boolean
 *               resolution:
 *                 type: string
 *                 example: "1280:720"
 *               resizeMode:
 *                 type: string
 *                 enum: [fit, cover, stretch]
 *     responses:
 *       200:
 *         description: Stitching successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       400:
 *         description: Invalid input
 *       500:
 *         description: Stitching failed
 */
app.post('/api/stitch', upload.single('customAudio'), (req, res) => {
    let { videos, mute, resolution, resizeMode } = req.body;
    
    // Parse videos if sent as string (FormData)
    if (typeof videos === 'string') {
        try {
            videos = JSON.parse(videos);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid videos data' });
        }
    }

    if (!videos || !Array.isArray(videos) || videos.length < 2) {
        return res.status(400).json({ error: 'Please select at least 2 videos to stitch.' });
    }

    const outputFilename = `stitched-${Date.now()}.mp4`;
    const outputPath = path.join(processedDir, outputFilename);
    const command = ffmpeg();

    // Validate and add video inputs
    for (const video of videos) {
        const videoPath = findFilePath(video);
        if (!videoPath) {
            return res.status(404).json({ error: `File not found: ${video}` });
        }
        command.input(videoPath);
    }

    // Add custom audio input if present
    if (req.file) {
        command.input(req.file.path).inputOptions(['-stream_loop', '1000']);
    }

    console.log(`Starting stitch for: ${videos.join(', ')} (Mute: ${mute}, Custom Audio: ${!!req.file})`);

    // Create complex filter
    const filterComplex = [];
    const inputs = [];
    const useOriginalAudio = !mute && !req.file;
    
    // Determine resolution and scaling logic
    let targetW = 1280;
    let targetH = 720;
    
    if (resolution && resolution !== 'original') {
        const parts = resolution.split(':');
        if (parts.length === 2) {
            targetW = parseInt(parts[0]);
            targetH = parseInt(parts[1]);
        }
    }

    const isCover = resizeMode === 'cover';
    const isStretch = resizeMode === 'stretch';
    
    videos.forEach((_, index) => {
        // Scale video
        let scaleFilter;
        if (isStretch) {
            scaleFilter = `scale=${targetW}:${targetH},setsar=1`;
        } else if (isCover) {
            // Smart Crop (Cover)
            scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`;
        } else {
            // Fit (Contain) - Default
            scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
        }

        filterComplex.push(`[${index}:v]${scaleFilter}[v${index}]`);
        
        if (useOriginalAudio) {
            inputs.push(`[v${index}][${index}:a]`);
        } else {
            inputs.push(`[v${index}]`);
        }
    });
    
    if (useOriginalAudio) {
        // Concat video and audio
        filterComplex.push(`${inputs.join('')}concat=n=${videos.length}:v=1:a=1[v][a]`);
        command.outputOptions(['-map [v]', '-map [a]']);
    } else {
        // Concat video only
        filterComplex.push(`${inputs.join('')}concat=n=${videos.length}:v=1:a=0[v]`);
        
        if (req.file) {
            // Map stitched video [v] and custom audio (last input)
            const audioInputIndex = videos.length;
            command.outputOptions(['-map [v]', `-map ${audioInputIndex}:a`, '-shortest']);
        } else {
            // Mute (Video only)
            command.outputOptions(['-map [v]']);
        }
    }

    command
        .complexFilter(filterComplex)
        .on('end', () => {
            console.log('Stitching finished');
            if (req.file) fs.unlink(req.file.path, () => {}); // Cleanup audio file
            res.json({ success: true, downloadUrl: `/processed/${outputFilename}` });
        })
        .on('error', (err) => {
            console.error('Stitch error:', err);
            if (req.file) fs.unlink(req.file.path, () => {});
            res.status(500).json({ error: 'Stitching failed. Ensure all videos have valid streams.' });
        })
        .save(outputPath);
});

// API: Change Video Speed
/**
 * @swagger
 * /api/speed:
 *   post:
 *     summary: Change the speed of a video
 *     description: |
 *       Change the playback speed of a video.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const response = await fetch('https://video.andre-ia.fr/api/speed', {
 *         method: 'POST',
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: JSON.stringify({
 *           filename: '1234567890-video.mp4',
 *           speed: 1.5
 *         })
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *               speed:
 *                 type: number
 *                 description: Speed multiplier (0.1 to 10)
 *     responses:
 *       200:
 *         description: Speed change successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       400:
 *         description: Invalid speed value
 *       404:
 *         description: File not found
 *       500:
 *         description: Speed change failed
 */
app.post('/api/speed', (req, res) => {
    const { filename, speed } = req.body;
    const speedFactor = parseFloat(speed);
    
    if (isNaN(speedFactor) || speedFactor < 0.1 || speedFactor > 10) {
        return res.status(400).json({ error: 'Speed must be between 0.1 and 10' });
    }

    const inputPath = findFilePath(filename);
    const outputFilename = `speed-${speedFactor}x-${Date.now()}.mp4`;
    const outputPath = path.join(processedDir, outputFilename);

    if (!inputPath) return res.status(404).json({ error: 'File not found' });

    console.log(`Changing speed: ${filename} -> ${speedFactor}x`);

    // Video: setpts = 1/speed * PTS
    const videoFilter = `setpts=${1/speedFactor}*PTS`;
    
    // Audio: atempo is limited to 0.5 - 2.0. Chain for higher/lower speeds.
    let audioFilters = [];
    let s = speedFactor;
    
    // Handle speed > 2.0
    while (s > 2.0) {
        audioFilters.push('atempo=2.0');
        s /= 2.0;
    }
    // Handle speed < 0.5
    while (s < 0.5) {
        audioFilters.push('atempo=0.5');
        s /= 0.5;
    }
    // Add remaining factor
    if (s !== 1.0) {
        audioFilters.push(`atempo=${s}`);
    }

    const command = ffmpeg(inputPath).outputOptions([`-filter:v ${videoFilter}`]);
    
    if (audioFilters.length > 0) {
        command.outputOptions([`-filter:a ${audioFilters.join(',')}`]);
    }

    command
        .on('end', () => {
            console.log('Speed change finished');
            res.json({ success: true, downloadUrl: `/processed/${outputFilename}` });
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).json({ error: 'Speed change failed' });
        })
        .save(outputPath);
});

// API: Mute Video
/**
 * @swagger
 * /api/mute:
 *   post:
 *     summary: Mute a video
 *     description: |
 *       Remove the audio track from a video.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const response = await fetch('https://video.andre-ia.fr/api/mute', {
 *         method: 'POST',
 *         headers: {
 *           'Content-Type': 'application/json',
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: JSON.stringify({
 *           filename: '1234567890-video.mp4'
 *         })
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *     responses:
 *       200:
 *         description: Mute successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       404:
 *         description: File not found
 *       500:
 *         description: Mute failed
 */
app.post('/api/mute', (req, res) => {
    const { filename } = req.body;
    const inputPath = findFilePath(filename);
    const outputFilename = `muted-${Date.now()}.mp4`;
    const outputPath = path.join(processedDir, outputFilename);

    if (!inputPath) return res.status(404).json({ error: 'File not found' });

    console.log(`Muting video: ${filename}`);

    ffmpeg(inputPath)
        .noAudio()
        .on('end', () => {
            console.log('Mute finished');
            res.json({ success: true, downloadUrl: `/processed/${outputFilename}` });
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).json({ error: 'Mute failed' });
        })
        .save(outputPath);
});

// API: Add Custom Audio
/**
 * @swagger
 * /api/add-audio:
 *   post:
 *     summary: Add custom audio to a video
 *     description: |
 *       Replace the audio of a video with a custom audio file.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const formData = new FormData();
 *       formData.append('videoFilename', '1234567890-video.mp4');
 *       formData.append('audio', audioFileInput.files[0]);
 *       
 *       const response = await fetch('https://video.andre-ia.fr/api/add-audio', {
 *         method: 'POST',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: formData
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               videoFilename:
 *                 type: string
 *               audio:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Audio added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *       400:
 *         description: Missing file or filename
 *       404:
 *         description: Video not found
 *       500:
 *         description: Failed to add audio
 */
app.post('/api/add-audio', upload.single('audio'), (req, res) => {
    const { videoFilename } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    if (!videoFilename) return res.status(400).json({ error: 'No video filename provided' });

    const videoPath = findFilePath(videoFilename);
    const audioPath = req.file.path;
    const outputFilename = `custom-audio-${Date.now()}.mp4`;
    const outputPath = path.join(processedDir, outputFilename);

    if (!videoPath) return res.status(404).json({ error: 'Video file not found' });

    console.log(`Adding audio to: ${videoFilename}`);

    ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
            '-map 0:v:0', // Use video from first input
            '-map 1:a:0', // Use audio from second input
            '-c:v copy',  // Copy video stream (fast)
            '-shortest'   // Stop when shortest stream ends
        ])
        .on('end', () => {
            console.log('Audio addition finished');
            // Clean up uploaded audio file
            fs.unlink(audioPath, () => {}); 
            res.json({ success: true, downloadUrl: `/processed/${outputFilename}` });
        })
        .on('error', (err) => {
            console.error('Error:', err);
            res.status(500).json({ error: 'Adding audio failed' });
        })
        .save(outputPath);
});

// API: Custom FFmpeg Command
/**
 * @swagger
 * /api/custom:
 *   post:
 *     summary: Execute custom FFmpeg operations
 *     description: |
 *       Execute complex FFmpeg operations including filters, resizing, and audio manipulation.
 *       
 *       ### JavaScript Fetch Example
 *       ```javascript
 *       const formData = new FormData();
 *       formData.append('filename', '1234567890-video.mp4');
 *       formData.append('format', 'mp4');
 *       formData.append('resolution', '1280:720');
 *       formData.append('resizeMode', 'cover');
 *       formData.append('speed', '1.0');
 *       formData.append('volume', '1.0');
 *       
 *       const response = await fetch('https://video.andre-ia.fr/api/custom', {
 *         method: 'POST',
 *         headers: {
 *           'ffmpeg-apikey': 'YOUR_API_KEY'
 *         },
 *         body: formData
 *       });
 *       const data = await response.json();
 *       console.log(data);
 *       ```
 *     tags: [Processing]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Filename of the video to process
 *               customAudio:
 *                 type: string
 *                 format: binary
 *                 description: Optional custom audio file
 *               format:
 *                 type: string
 *                 enum: [mp4, mov, avi, mp3, gif]
 *               videoCodec:
 *                 type: string
 *               audioCodec:
 *                 type: string
 *               videoFilters:
 *                 type: string
 *                 description: Comma-separated list of video filters
 *               audioFilters:
 *                 type: string
 *                 description: Comma-separated list of audio filters
 *               speed:
 *                 type: number
 *               mute:
 *                 type: boolean
 *               volume:
 *                 type: number
 *                 description: Volume multiplier (e.g., 1.0, 0.5, 2.0)
 *               fadeIn:
 *                 type: number
 *                 description: Fade in duration in seconds
 *               fadeOut:
 *                 type: number
 *                 description: Fade out duration in seconds
 *               resolution:
 *                 type: string
 *                 example: "1280:720"
 *               resizeMode:
 *                 type: string
 *                 enum: [fit, cover, stretch]
 *     responses:
 *       200:
 *         description: Processing successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *                 filename:
 *                   type: string
 *       404:
 *         description: File not found
 *       500:
 *         description: Processing failed
 */
app.post('/api/custom', upload.single('customAudio'), (req, res) => {
    const { filename, format, videoCodec, audioCodec, videoFilters, audioFilters, speed, mute, volume, fadeIn, fadeOut, resolution, resizeMode } = req.body;
    
    // Check for file in uploads OR processed folder (for chained operations)
    const inputPath = findFilePath(filename);

    const outputFilename = `custom-${Date.now()}.${format || 'mp4'}`;
    const outputPath = path.join(processedDir, outputFilename);

    if (!inputPath) return res.status(404).json({ error: 'File not found' });

    console.log(`Starting custom command for: ${filename} (Audio: ${!!req.file})`);

    // Get video duration first to ensure audio loops correctly
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
            console.error('Probe error:', err);
            return res.status(500).json({ error: 'Failed to probe video file' });
        }

        const videoDuration = metadata.format.duration;
        const command = ffmpeg(inputPath);

        let vFilters = videoFilters ? videoFilters.split(',').map(f => f.trim()).filter(Boolean) : [];
        let aFilters = audioFilters ? audioFilters.split(',').map(f => f.trim()).filter(Boolean) : [];

        // Handle Resolution & Resize Mode
        if (resolution && resolution !== 'original') {
            const parts = resolution.split(':');
            if (parts.length === 2) {
                const targetW = parseInt(parts[0]);
                const targetH = parseInt(parts[1]);
                
                if (resizeMode === 'stretch') {
                    vFilters.unshift(`scale=${targetW}:${targetH},setsar=1`);
                } else if (resizeMode === 'cover') {
                    // Smart Crop
                    vFilters.unshift(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`);
                } else {
                    // Contain (Fit)
                    vFilters.unshift(`scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1`);
                }
            }
        }

        // Handle Speed (Video)
        let finalDuration = videoDuration;
        if (speed) {
            const speedFactor = parseFloat(speed);
            if (!isNaN(speedFactor) && speedFactor > 0) {
                vFilters.push(`setpts=${1/speedFactor}*PTS`);
                finalDuration = videoDuration / speedFactor;
                
                // Audio Speed (only if not muted AND no custom audio)
                if (!req.file && !mute && mute !== 'true') {
                    let s = speedFactor;
                    if (s >= 0.5 && s <= 2.0) {
                        aFilters.push(`atempo=${s}`);
                    } else if (s > 2.0) {
                        while (s > 2.0) { aFilters.push('atempo=2.0'); s /= 2.0; }
                        aFilters.push(`atempo=${s}`);
                    } else if (s < 0.5) {
                        while (s < 0.5) { aFilters.push('atempo=0.5'); s /= 0.5; }
                        aFilters.push(`atempo=${s}`);
                    }
                }
            }
        }

        // Handle Volume
        if (volume && !isNaN(parseFloat(volume))) {
            aFilters.push(`volume=${volume}`);
        }

        // Handle Fade In
        if (fadeIn && !isNaN(parseFloat(fadeIn)) && parseFloat(fadeIn) > 0) {
            aFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
        }

        // Handle Fade Out
        if (fadeOut && !isNaN(parseFloat(fadeOut)) && parseFloat(fadeOut) > 0) {
            const fadeOutDuration = parseFloat(fadeOut);
            // Ensure start time is not negative
            const startTime = Math.max(0, finalDuration - fadeOutDuration);
            aFilters.push(`afade=t=out:st=${startTime}:d=${fadeOutDuration}`);
        }

        // Handle Custom Audio
        if (req.file) {
            // Use aloop filter to loop audio indefinitely
            // [1:a] refers to the second input (audio file)
            command.input(req.file.path);
            
            // We need to use complex filter to loop audio
            // aloop=loop=-1:size=2e9 loops the audio stream
            // We map the looped audio to [a]
            // Note: We must be careful not to conflict with other filters
            
            // Instead of complex filter for looping, let's use the duration approach with -stream_loop
            // But since stream_loop was problematic, let's try the input option again with the explicit duration
            
            // Actually, let's use the aloop filter as it is more robust within the filter graph
            // We need to add it to the complex filter chain
            
            // But wait, fluent-ffmpeg handles filters separately.
            // Let's use the simple input loop option but force the output duration
            
            command.inputOptions(['-stream_loop', '-1']); // Apply to the audio input (which is added next? No, fluent-ffmpeg is tricky)
            
            // Let's reconstruct:
            // command is ffmpeg(inputPath) -> Input 0
            // command.input(req.file.path) -> Input 1
            // We want stream_loop on Input 1.
            
            // Correct way in fluent-ffmpeg for input options on specific input:
            // ffmpeg().input(input1).input(input2).inputOptions(...) -> applies to input2? No.
            
            // Let's use the explicit addInput method with options
            // But command is already created.
            
            // Let's try the filter_complex approach which is unambiguous
            // We will map [1:a] through aloop
            
            // However, mixing simple audioFilters and complexFilter is hard.
            // Let's stick to the user's request: "take the video length"
            
            // We have finalDuration.
            // We will use -t finalDuration on the output.
            // And we will use -stream_loop -1 on the audio input.
            // To ensure stream_loop applies to audio, we use addInputOption BEFORE adding the input?
            // No, fluent-ffmpeg: .input(file).inputOptions(...)
            
        } else {
            // Handle Mute
            if (mute === true || mute === 'true') {
                command.noAudio();
            }
        }

        if (format) command.toFormat(format);
        if (videoCodec) command.videoCodec(videoCodec);
        if (audioCodec) command.audioCodec(audioCodec);
        
        if (vFilters.length > 0) command.videoFilters(vFilters);
        if (aFilters.length > 0) command.audioFilters(aFilters);

        // Re-implement Custom Audio logic with correct scoping
        if (req.file) {
             // We need to add the input AND options
             // Note: command.input() adds a new input.
             // We want to add the audio file with stream_loop
             command.addInput(req.file.path);
             command.addInputOption('-stream_loop', '-1');
             
             // Map video from 0 and audio from 1
             command.outputOptions(['-map 0:v', '-map 1:a']);
             
             // Set explicit duration
             command.duration(finalDuration);
        }

        command
            .on('start', (cmdLine) => console.log('FFmpeg command:', cmdLine))
            .on('end', () => {
                console.log('Custom command finished');
                if (req.file) fs.unlink(req.file.path, () => {}); // Cleanup audio
                res.json({ success: true, downloadUrl: `/processed/${outputFilename}`, filename: outputFilename });
            })
            .on('error', (err) => {
                console.error('Custom command error:', err);
                if (req.file) fs.unlink(req.file.path, () => {}); // Cleanup audio
                res.status(500).json({ error: 'Custom command failed: ' + err.message });
            })
            .save(outputPath);
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
