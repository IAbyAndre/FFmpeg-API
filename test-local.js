const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.FFMPEG_APIKEY;
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function testStitch() {
    console.log('--- Testing Stitch API with Local URLs ---');
    
    const payload = {
        videos: [
            `${BASE_URL}/processed/custom-1766360500423.mp4`,
            `${BASE_URL}/processed/custom-1766360557437.mp4`
        ],
        resolution: "original",
        resizeMode: "contain"
    };

    try {
        const response = await axios.post(`${BASE_URL}/api/stitch`, payload, {
            headers: {
                'ffmpeg-apikey': API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('Success!');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testStitch();
