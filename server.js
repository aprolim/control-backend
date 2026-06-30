// server.js
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
import configuracionRoutes from './routes/configuracion.js';
import { iniciarAutoCierreService } from './services/autoCierreService.js';
import os from 'os';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://172.16.30.212:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://172.16.30.212:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Función para obtener IP local
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
console.log(`📡 IP detectada: ${LOCAL_IP}`);

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

app.set('io', io);
app.set('clients', clients);

// ============================================================
// RUTAS
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/tarjetas', tarjetaRoutes);
app.use('/api/empleados', empleadoRoutes);
app.use('/api/estadisticas', estadisticasRoutes);
app.use('/api/solicitudes', solicitudRoutes);
app.use('/api/configuracion', configuracionRoutes);

// Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), ip: LOCAL_IP });
});

// ============================================================
// CONEXIÓN A MONGODB
// ============================================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;

// ============================================================
// INICIAR SERVIDOR - EXPUESTO EN LA RED
// ============================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 Servidor backend iniciado');
  console.log(`📍 Local:    http://localhost:${PORT}`);
  console.log(`📍 Red:      http://${LOCAL_IP}:${PORT}`);
  console.log(`📍 Health:   http://${LOCAL_IP}:${PORT}/api/health`);
  console.log('========================================');
  iniciarAutoCierreService(io, clients);
});