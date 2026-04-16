const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkTable() {
    const url = process.env.DATABASE_URL.replace('localhost', '127.0.0.1'); // Try 127.0.0.1 first
    console.log('Checking user table structure at:', url);
    let connection;
    try {
        connection = await mysql.createConnection(url);
        const [rows] = await connection.execute('DESCRIBE `user`');
        console.log('--- User Table Structure ---');
        rows.forEach(row => {
            console.log(`${row.Field}: ${row.Type} (${row.Null}, ${row.Default})`);
        });
        console.log('---------------------------');
    } catch (err) {
        console.log('❌ Error with 127.0.0.1, trying localhost...');
        try {
            const localUrl = process.env.DATABASE_URL.replace('127.0.0.1', 'localhost');
            connection = await mysql.createConnection(localUrl);
            const [rows] = await connection.execute('DESCRIBE `user`');
            console.log('--- User Table Structure ---');
            rows.forEach(row => {
                console.log(`${row.Field}: ${row.Type} (${row.Null}, ${row.Default})`);
            });
            console.log('---------------------------');
        } catch (err2) {
            console.error('❌ Failed to connect to DB:', err2.message);
        }
    } finally {
        if (connection) await connection.end();
    }
}

checkTable();
