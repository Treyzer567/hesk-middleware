const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const cheerio = require('cheerio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Use node-fetch v2 (CommonJS compatible)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3001;
const HESK_URL = process.env.HESK_URL || 'http://your-server-ip:8140';
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'public');

// Serve static files (HTML form, etc.) from STATIC_DIR
if (fs.existsSync(STATIC_DIR)) {
    console.log(`Serving static files from: ${STATIC_DIR}`);
    app.use(express.static(STATIC_DIR));
} else {
    console.log(`Static directory not found: ${STATIC_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: '/tmp/uploads/',
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024,
        files: 2
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['jpg', 'jpeg', 'png', 'gif', 'txt', 'pdf', 'doc', 'docx', 'zip', 'rar', 'csv', 'xls', 'xlsx'];
        const ext = file.originalname.split('.').pop().toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type .${ext} not allowed`));
        }
    }
});

// Ensure upload directory exists
if (!fs.existsSync('/tmp/uploads')) {
    fs.mkdirSync('/tmp/uploads', { recursive: true });
}

// Enable CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', hesk_url: HESK_URL });
});

/**
 * Upload a single file to Hesk's async upload endpoint
 * Returns the temp filename that Hesk stored
 */
async function uploadFileToHesk(file, cookies, token) {
    const uploadUrl = `${HESK_URL}/upload_attachment.php`;
    
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(file.path);
    
    formData.append('attachment', fileBuffer, {
        filename: file.originalname,
        contentType: file.mimetype
    });
    
    if (token) {
        formData.append('token', token);
    }
    
    console.log(`  Uploading ${file.originalname} to ${uploadUrl}...`);
    
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Cookie': cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            ...formData.getHeaders()
        },
        body: formData
    });
    
    const responseText = await response.text();
    console.log(`  Upload response (${response.status}): ${responseText.substring(0, 200)}`);
    
    // Try to parse JSON response
    try {
        const json = JSON.parse(responseText);
        if (json.status === 'success' || json.file_key) {
            return json;
        }
        return { error: json.message || 'Upload failed' };
    } catch (e) {
        // Not JSON - might be HTML or plain text
        // Look for any indication of success
        if (responseText.includes('success') || response.ok) {
            return { status: 'unknown', raw: responseText };
        }
        return { error: 'Could not parse upload response' };
    }
}

// Main ticket submission endpoint
app.post('/submit-ticket', upload.array('attachments', 2), async (req, res) => {
    console.log('='.repeat(60));
    console.log('Received ticket submission request');
    console.log('Body:', req.body);
    
    if (req.files && req.files.length > 0) {
        console.log('Files received:');
        req.files.forEach((f, i) => {
            console.log(`  [${i}] ${f.originalname} (${f.size} bytes, ${f.mimetype})`);
        });
    } else {
        console.log('No files received');
    }

    try {
        // Step 1: Fetch Hesk's form page to get session cookie and CSRF token
        console.log('Step 1: Fetching Hesk form page for token...');
        
        const category = req.body.category || '1';
        const formPageUrl = `${HESK_URL}/index.php?a=add&category=${category}`;
        
        const formPageResponse = await fetch(formPageUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        });

        if (!formPageResponse.ok) {
            throw new Error(`Failed to fetch Hesk form page: ${formPageResponse.status}`);
        }

        // Get cookies from response
        const cookies = formPageResponse.headers.raw()['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
        console.log('Got cookies:', cookieString ? 'Yes' : 'No');

        // Parse HTML to extract token and find attachment upload info
        const html = await formPageResponse.text();
        const $ = cheerio.load(html);
        const token = $('input[name="token"]').val();
        
        console.log('Extracted token:', token ? `${token.substring(0, 10)}...` : 'NOT FOUND');
        
        // Look for attachment-related JavaScript/config
        const hasDropzone = html.includes('Dropzone') || html.includes('dropzone');
        const hasUploadAttachment = html.includes('upload_attachment');
        console.log('Dropzone detected:', hasDropzone);
        console.log('Upload attachment endpoint detected:', hasUploadAttachment);

        // Step 2: Try async upload if files present
        let uploadedFileKeys = [];
        
        if (req.files && req.files.length > 0 && hasUploadAttachment) {
            console.log('Step 2: Attempting async file uploads to Hesk...');
            
            for (const file of req.files) {
                const result = await uploadFileToHesk(file, cookieString, token);
                if (result.file_key) {
                    uploadedFileKeys.push(result.file_key);
                    console.log(`  Uploaded successfully: ${result.file_key}`);
                } else {
                    console.log(`  Upload result:`, result);
                }
            }
        }

        // Step 3: Build the form data for submission
        console.log('Step 3: Building form data...');
        
        const formData = new FormData();
        
        // Anti-spam fields
        formData.append('hx', '3');
        formData.append('hy', '');
        
        // Add token if we got one
        if (token) {
            formData.append('token', token);
        }
        
        // Map priority text to Hesk numeric values
        // Hesk uses: 0=Critical, 1=High, 2=Medium, 3=Low
        const priorityMap = {
            'critical': '0',
            'high': '1',
            'medium': '2',
            'low': '3'
        };
        const priorityValue = priorityMap[req.body.priority?.toLowerCase()] || '3';
        
        // Required fields
        formData.append('name', req.body.name || '');
        formData.append('email', req.body.email || '');
        formData.append('category', category);
        formData.append('subject', req.body.subject || '');
        formData.append('message', req.body.message || '');
        formData.append('priority', priorityValue);

        // Add uploaded file keys if async upload was used
        // Hesk expects field name "attachments[]" with just the file_key as value
        if (uploadedFileKeys.length > 0) {
            uploadedFileKeys.forEach((key) => {
                formData.append('attachments[]', key);
                console.log(`Added attachments[]: ${key}`);
            });
        }

        // Step 4: Submit to Hesk
        console.log('Step 4: Submitting to Hesk...');
        
        const submitUrl = `${HESK_URL}/submit_ticket.php?submit=1`;
        
        const submitResponse = await fetch(submitUrl, {
            method: 'POST',
            headers: {
                'Cookie': cookieString,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': formPageUrl,
                'Origin': HESK_URL,
                ...formData.getHeaders()
            },
            body: formData
        });

        console.log('Response status:', submitResponse.status);
        
        const responseHtml = await submitResponse.text();
        
        // Clean up uploaded files
        if (req.files) {
            req.files.forEach(file => {
                fs.unlink(file.path, () => {});
            });
        }

        // Step 5: Parse response
        console.log('Step 5: Parsing response...');
        
        const $response = cheerio.load(responseHtml);
        
        const trackingIdMatch = responseHtml.match(/[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{4}/);
        const hasError = responseHtml.includes('class="notification red"') || 
                        responseHtml.includes('hesk_error') ||
                        responseHtml.includes('Please correct the following errors');
        
        const isFormPage = responseHtml.includes('Submit a Support Request') && 
                          responseHtml.includes('name="subject"');

        // Check for attachment mentions
        const attachmentMentioned = responseHtml.toLowerCase().includes('attachment');
        console.log('Attachment mentioned in response:', attachmentMentioned);

        if (trackingIdMatch && !hasError) {
            const ticketId = trackingIdMatch[0];
            console.log('Success! Ticket ID:', ticketId);
            
            res.json({
                success: true,
                ticketId: ticketId,
                message: `Ticket ${ticketId} created successfully`,
                filesUploaded: req.files ? req.files.length : 0
            });
        } else if (hasError || isFormPage) {
            let errorMessage = 'Unknown error occurred';
            
            const errorDiv = $response('.notification.red').text() || 
                           $response('.error').text() ||
                           $response('.hesk_error').text();
            
            if (errorDiv) {
                errorMessage = errorDiv.replace(/\s+/g, ' ').trim();
            }

            console.log('Error from Hesk:', errorMessage);
            console.log('Response preview:', responseHtml.substring(0, 500));
            
            res.status(400).json({
                success: false,
                error: errorMessage
            });
        } else {
            console.log('Unclear response, assuming success...');
            
            if (submitResponse.ok && !hasError) {
                res.json({
                    success: true,
                    message: 'Ticket submitted (could not confirm ticket ID)',
                    note: 'Check your email for confirmation'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Could not determine submission result'
                });
            }
        }

    } catch (error) {
        console.error('Error submitting ticket:', error);
        
        if (req.files) {
            req.files.forEach(file => {
                fs.unlink(file.path, () => {});
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
    
    console.log('='.repeat(60));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Express error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'File too large (max 2MB)' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ success: false, error: 'Too many files (max 2)' });
        }
    }
    
    res.status(500).json({ success: false, error: error.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hesk Middleware running on port ${PORT}`);
    console.log(`Hesk URL: ${HESK_URL}`);
    console.log(`Static files: ${STATIC_DIR}`);
});
