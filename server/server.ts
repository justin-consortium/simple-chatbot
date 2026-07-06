import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import profileRoutes from './routes/profile';
import sessionRoutes from './routes/session';

const app = express();

// The app runs behind a reverse proxy (nginx / GCP) in prod that terminates TLS,
// so the real client IP arrives in X-Forwarded-For. Trust one proxy hop so
// express-rate-limit keys on the actual client IP rather than the proxy's.
// Verify the hop count on deploy (SSH + `req.ip`, or express-rate-limit's
// startup warning) — too high a value lets clients spoof their IP.
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/session', sessionRoutes);

mongoose
  .connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT ?? 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

