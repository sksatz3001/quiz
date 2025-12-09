const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// PostgreSQL connection using Neon
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_S02yqZLxIpdz@ep-summer-night-ahegvpko-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize database tables
async function initDatabase() {
    try {
        // Main quiz results table with status tracking
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quiz_results (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) UNIQUE,
                full_name VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(50),
                age INTEGER,
                gender VARCHAR(20),
                education VARCHAR(100),
                occupation VARCHAR(255),
                location VARCHAR(255),
                answers JSONB,
                scores JSONB,
                top_three_code VARCHAR(10),
                time_taken INTEGER,
                status VARCHAR(20) DEFAULT 'incomplete',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                user_agent TEXT,
                ip_address VARCHAR(45)
            )
        `);
        
        // Add status column if it doesn't exist (for existing tables)
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name='quiz_results' AND column_name='status') THEN
                    ALTER TABLE quiz_results ADD COLUMN status VARCHAR(20) DEFAULT 'incomplete';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name='quiz_results' AND column_name='started_at') THEN
                    ALTER TABLE quiz_results ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        console.log('Database tables initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Generate session ID
function generateSessionId() {
    return 'quiz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Admin credentials (in production, use environment variables and hashed passwords)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

// Simple session management for admin
const adminSessions = new Set();

function generateAdminToken() {
    return 'admin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 16);
}

// RIASEC descriptions for PDF
const riasecDescriptions = {
    R: { name: 'Realistic', nepali: 'यथार्थवादी', careers: 'Engineer, Mechanic, Electrician, Carpenter, Farmer' },
    I: { name: 'Investigative', nepali: 'अन्वेषणात्मक', careers: 'Scientist, Researcher, Doctor, Professor, Analyst' },
    A: { name: 'Artistic', nepali: 'कलात्मक', careers: 'Artist, Designer, Writer, Musician, Actor' },
    S: { name: 'Social', nepali: 'सामाजिक', careers: 'Teacher, Counselor, Nurse, Social Worker, HR Manager' },
    E: { name: 'Enterprising', nepali: 'उद्यमशील', careers: 'Manager, Salesperson, Lawyer, Entrepreneur, Politician' },
    C: { name: 'Conventional', nepali: 'परम्परागत', careers: 'Accountant, Administrator, Banker, Data Analyst, Secretary' }
};

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
};

// Parse JSON body from request
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// Check admin authentication from cookie
function isAdminAuthenticated(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/adminToken=([^;]+)/);
    if (match && adminSessions.has(match[1])) {
        return true;
    }
    return false;
}

// Generate PDF-like HTML report
function generatePDFContent(data) {
    const scores = data.scores;
    const topThree = data.topThreeCode.split('');
    const sortedTypes = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RIASEC Career Assessment Report - ${data.fullName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; background: white; padding: 40px; }
        .report { max-width: 800px; margin: 0 auto; background: white; }
        .header { text-align: center; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { color: #1e40af; font-size: 28px; margin-bottom: 5px; }
        .header h2 { color: #64748b; font-size: 18px; font-weight: normal; }
        .header .subtitle { color: #64748b; font-size: 14px; margin-top: 10px; }
        .section { margin-bottom: 30px; }
        .section-title { background: #f1f5f9; padding: 10px 15px; font-size: 16px; font-weight: 600; color: #1e40af; border-left: 4px solid #2563eb; margin-bottom: 15px; }
        .user-info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .info-item { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
        .info-label { font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; }
        .info-value { color: #1e293b; font-size: 14px; }
        .holland-code { text-align: center; padding: 20px; background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; border-radius: 10px; margin-bottom: 20px; }
        .holland-code h3 { font-size: 14px; opacity: 0.9; margin-bottom: 10px; }
        .code-letters { font-size: 48px; font-weight: bold; letter-spacing: 10px; }
        .scores-table { width: 100%; border-collapse: collapse; }
        .scores-table th, .scores-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        .scores-table th { background: #f8fafc; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; }
        .scores-table tr:hover { background: #f8fafc; }
        .score-bar { width: 100%; height: 20px; background: #e2e8f0; border-radius: 10px; overflow: hidden; }
        .score-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); border-radius: 10px; }
        .top-type { background: #eff6ff !important; }
        .type-badge { display: inline-block; padding: 2px 8px; background: #2563eb; color: white; border-radius: 4px; font-size: 11px; margin-left: 10px; }
        .career-section { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .career-type { font-weight: 600; color: #1e40af; margin-bottom: 5px; }
        .career-list { color: #64748b; font-size: 14px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
        .print-button { position: fixed; bottom: 20px; right: 20px; background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
        .print-button:hover { background: #1d4ed8; }
        @media print { .print-button { display: none; } body { padding: 20px; } }
    </style>
</head>
<body>
    <div class="report">
        <div class="header">
            <h1>RIASEC Career Assessment Report</h1>
            <h2>Holland Code Interest Inventory</h2>
            <p class="subtitle">व्यावसायिक रुचि मूल्यांकन प्रतिवेदन</p>
        </div>
        
        <div class="section">
            <div class="section-title">Personal Information / व्यक्तिगत जानकारी</div>
            <div class="user-info">
                <div class="info-item"><div class="info-label">Full Name / पूरा नाम</div><div class="info-value">${data.fullName}</div></div>
                <div class="info-item"><div class="info-label">Email / इमेल</div><div class="info-value">${data.email}</div></div>
                <div class="info-item"><div class="info-label">Phone / फोन</div><div class="info-value">${data.phone}</div></div>
                <div class="info-item"><div class="info-label">Age / उमेर</div><div class="info-value">${data.age}</div></div>
                <div class="info-item"><div class="info-label">Gender / लिङ्ग</div><div class="info-value">${data.gender}</div></div>
                <div class="info-item"><div class="info-label">Education / शिक्षा</div><div class="info-value">${data.education}</div></div>
                <div class="info-item"><div class="info-label">Occupation / पेशा</div><div class="info-value">${data.occupation}</div></div>
                <div class="info-item"><div class="info-label">Location / स्थान</div><div class="info-value">${data.location}</div></div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Your Holland Code / तपाईंको होल्याण्ड कोड</div>
            <div class="holland-code">
                <h3>TOP THREE INTEREST TYPES</h3>
                <div class="code-letters">${topThree.join('')}</div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Detailed Scores / विस्तृत स्कोर</div>
            <table class="scores-table">
                <thead>
                    <tr><th>Type</th><th>Name / नाम</th><th>Score</th><th>Visual</th></tr>
                </thead>
                <tbody>
                    ${sortedTypes.map(([type, score], index) => `
                        <tr class="${index < 3 ? 'top-type' : ''}">
                            <td><strong>${type}</strong>${index < 3 ? `<span class="type-badge">#${index + 1}</span>` : ''}</td>
                            <td>${riasecDescriptions[type].name} / ${riasecDescriptions[type].nepali}</td>
                            <td><strong>${score}</strong> / 7</td>
                            <td><div class="score-bar"><div class="score-fill" style="width: ${(score / 7) * 100}%"></div></div></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="section">
            <div class="section-title">Career Suggestions / क्यारियर सुझावहरू</div>
            ${topThree.map((type, index) => `
                <div class="career-section">
                    <div class="career-type">${index + 1}. ${riasecDescriptions[type].name} (${type}) - ${riasecDescriptions[type].nepali}</div>
                    <div class="career-list">${riasecDescriptions[type].careers}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="footer">
            <p>Report Generated: ${new Date().toLocaleString()}</p>
            <p>RIASEC Career Assessment Tool | Holland Code Interest Inventory</p>
            <p>This report is for guidance purposes only and should be used alongside professional career counseling.</p>
        </div>
    </div>
    
    <button class="print-button" onclick="window.print()">🖨️ Print / Save as PDF</button>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ============ USER REGISTRATION (tracks incomplete assessments) ============
    if (req.method === 'POST' && pathname === '/api/register-user') {
        try {
            const data = await parseBody(req);
            const sessionId = generateSessionId();
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

            await pool.query(
                `INSERT INTO quiz_results (
                    session_id, full_name, email, phone, age, gender, education, occupation, location,
                    status, started_at, user_agent, ip_address
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'incomplete', CURRENT_TIMESTAMP, $10, $11)`,
                [
                    sessionId,
                    data.fullName,
                    data.email,
                    data.phone,
                    data.age || null,
                    data.gender,
                    data.education,
                    data.occupation,
                    data.location,
                    userAgent,
                    ipAddress
                ]
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId }));
        } catch (error) {
            console.error('Error registering user:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to register user' }));
        }
        return;
    }

    // ============ SAVE QUIZ RESULTS (marks as complete) ============
    if (req.method === 'POST' && pathname === '/api/save-quiz') {
        try {
            const data = await parseBody(req);
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

            if (data.sessionId) {
                // Update existing record (from registration)
                await pool.query(
                    `UPDATE quiz_results SET
                        answers = $1,
                        scores = $2,
                        top_three_code = $3,
                        time_taken = $4,
                        status = 'complete',
                        completed_at = $5
                    WHERE session_id = $6`,
                    [
                        JSON.stringify(data.answers),
                        JSON.stringify(data.scores),
                        data.topThreeCode,
                        data.timeTaken,
                        data.completedAt,
                        data.sessionId
                    ]
                );
            } else {
                // Insert new record (fallback if no session)
                const sessionId = generateSessionId();
                await pool.query(
                    `INSERT INTO quiz_results (
                        session_id, full_name, email, phone, age, gender, education, occupation, location,
                        answers, scores, top_three_code, time_taken, status, completed_at, user_agent, ip_address
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'complete', $14, $15, $16)`,
                    [
                        sessionId,
                        data.fullName,
                        data.email,
                        data.phone,
                        data.age,
                        data.gender,
                        data.education,
                        data.occupation,
                        data.location,
                        JSON.stringify(data.answers),
                        JSON.stringify(data.scores),
                        data.topThreeCode,
                        data.timeTaken,
                        data.completedAt,
                        userAgent,
                        ipAddress
                    ]
                );
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('Error saving quiz:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to save quiz results' }));
        }
        return;
    }

    // ============ GENERATE PDF ============
    if (req.method === 'POST' && pathname === '/api/generate-pdf') {
        try {
            const data = await parseBody(req);
            const pdfHtml = generatePDFContent(data);
            const safeName = (data.fullName || 'User').replace(/\s+/g, '_');
            
            res.writeHead(200, { 
                'Content-Type': 'text/html',
                'Content-Disposition': `attachment; filename="RIASEC_Report_${safeName}.html"`
            });
            res.end(pdfHtml);
        } catch (error) {
            console.error('Error generating PDF:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate PDF' }));
        }
        return;
    }

    // ============ ADMIN LOGIN ============
    if (req.method === 'POST' && pathname === '/api/admin/login') {
        try {
            const data = await parseBody(req);
            
            if (data.username === ADMIN_USERNAME && data.password === ADMIN_PASSWORD) {
                const token = generateAdminToken();
                adminSessions.add(token);
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': `adminToken=${token}; HttpOnly; Path=/; Max-Age=86400`
                });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid credentials' }));
            }
        } catch (error) {
            console.error('Error during login:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Login failed' }));
        }
        return;
    }

    // ============ ADMIN LOGOUT ============
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
        const cookie = req.headers.cookie || '';
        const match = cookie.match(/adminToken=([^;]+)/);
        if (match) {
            adminSessions.delete(match[1]);
        }
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Set-Cookie': 'adminToken=; HttpOnly; Path=/; Max-Age=0'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // ============ CHECK ADMIN AUTH ============
    if (req.method === 'GET' && pathname === '/api/admin/check-auth') {
        if (isAdminAuthenticated(req)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: true }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: false }));
        }
        return;
    }

    // ============ ADMIN: GET ALL RESULTS ============
    if (req.method === 'GET' && pathname === '/api/admin/results') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const status = url.searchParams.get('status');
            
            let query = 'SELECT * FROM quiz_results';
            let params = [];
            
            if (status) {
                query += ' WHERE status = $1';
                params.push(status);
            }
            
            query += ' ORDER BY started_at DESC';
            
            const result = await pool.query(query, params);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.rows));
        } catch (error) {
            console.error('Error fetching results:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch results' }));
        }
        return;
    }

    // ============ ADMIN: GET STATISTICS ============
    if (req.method === 'GET' && pathname === '/api/admin/stats') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const totalResult = await pool.query('SELECT COUNT(*) as count FROM quiz_results');
            const completeResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE status = 'complete'");
            const incompleteResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE status = 'incomplete'");
            const todayResult = await pool.query("SELECT COUNT(*) as count FROM quiz_results WHERE started_at >= CURRENT_DATE");
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                total: parseInt(totalResult.rows[0].count),
                complete: parseInt(completeResult.rows[0].count),
                incomplete: parseInt(incompleteResult.rows[0].count),
                today: parseInt(todayResult.rows[0].count)
            }));
        } catch (error) {
            console.error('Error fetching stats:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch statistics' }));
        }
        return;
    }

    // ============ ADMIN: DELETE RESULT ============
    if (req.method === 'POST' && pathname === '/api/admin/delete') {
        if (!isAdminAuthenticated(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        try {
            const data = await parseBody(req);
            await pool.query('DELETE FROM quiz_results WHERE id = $1', [data.id]);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error('Error deleting result:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to delete result' }));
        }
        return;
    }

    // ============ SERVE STATIC FILES ============
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Admin panel at http://localhost:${PORT}/admin.html`);
        console.log('Quiz is ready! Open the URL in your browser.');
    });
});
