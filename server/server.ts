import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import profileRoutes from './routes/profile';
import chatbotConfig from './config/chatbot.config';

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/profile', profileRoutes);

app.get('/api/agent', (_req, res) => {
  res.json({ name: chatbotConfig.name });
});

mongoose
  .connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT ?? 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

