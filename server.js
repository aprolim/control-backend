import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import tarjetaRoutes from './routes/tarjetas.js';
import empleadoRoutes from './routes/empleados.js';
import estadisticasRoutes from './routes/estadisticas.js';
import solicitudRoutes from './routes/solicitudes.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Socket.IO
const clients = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Cliente Socket.IO conectado');
  
  socket.on('join', (userId) => {
    socket.userId = userId;
    clients.set(userId, socket);
    console.log(`👤 Usuario ${userId} unido`);
    socket.emit('connected', { userId, message: 'Conectado al servidor' });
  });
  
  socket.on('disconnect', () => {
    if (socket.userId) {
      clients.delete(socket.userId);
      console.log(`👤 Usuario ${socket.userId} desconectado`);
    }
  });
});

// Hacer io accesible en las rutas
app.set('io', io);
app.set('clients', clients);

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/tarjetas', tarjetaRoutes);
app.use('/api/empleados', empleadoRoutes);
app.use('/api/estadisticas', estadisticasRoutes);
app.use('/api/solicitudes', solicitudRoutes);

// Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`);
});