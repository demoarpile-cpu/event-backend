const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
    const url = process.env.DATABASE_URL.replace('127.0.0.1', 'localhost');
    console.log('Testing connection to:', url);
    try {
        const connection = await mysql.createConnection(url);
        console.log('✅ Success! Connected to MySQL.');
        await connection.end();
    } catch (err) {
        console.error('❌ Failed to connect:', err.message);
    }
}

testConnection();
