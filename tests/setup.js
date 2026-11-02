// Runs before every integration test file. Loads Supabase credentials for a DEDICATED TEST project from .env.test
// (copy .env.test.example). Tests delete all data, so they refuse to run unless ALLOW_DESTRUCTIVE_TESTS=yes.
import { config } from 'dotenv';

config({ path: '.env.test' });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-123456';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.WHATSAPP_BUSINESS_NUMBER = '919574546023';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
