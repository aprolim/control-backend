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

// ============================================================
// SOCKET.IO CONFIGURACIÓN
// ============================================================
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://172.16.30.212:3000',
      'http://172.16.30.212:3001'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

app.set('trust proxy', 1);

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://172.16.30.212:3000',
    'http://172.16.30.212:3001'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// DETECTAR IP LOCAL
// ============================================================
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

// ============================================================
// SOCKET.IO - GESTIÓN DE USUARIOS
// ============================================================
const clients = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Cliente Socket.IO conectado:', socket.id);
  
  // Unir usuario a su sala personal
  socket.on('join', (userId) => {
    if (userId) {
      socket.userId = userId;
      clients.set(userId.toString(), socket);
      
      // Unir a sala personal
      socket.join(`user:${userId}`);
      
      console.log(`👤 Usuario ${userId} unido (socket: ${socket.id})`);
      console.log(`   👥 Usuarios conectados: ${clients.size}`);
      
      socket.emit('connected', { 
        userId, 
        message: 'Conectado al servidor',
        socketId: socket.id,
        clientsCount: clients.size
      });
    }
  });
  
  // ============================================================
  // EVENTOS DE TIEMPO REAL
  // ============================================================
  
  // Nueva tarea disponible
  socket.on('nueva-tarea-disponible', (data) => {
    console.log(`📢 [Socket] Nueva tarea disponible:`, data.tarea?.titulo);
    io.emit('nueva-tarea-disponible', data);
  });
  
  // Tarea asignada
  socket.on('tarea-asignada', (data) => {
    console.log(`📢 [Socket] Tarea asignada:`, data.tarea?.titulo);
    io.emit('tarea-asignada', data);
  });
  
  // Tarea tomada
  socket.on('tarea-tomada', (data) => {
    console.log(`📢 [Socket] Tarea tomada por:`, data.empleado?.nombre);
    io.emit('tarea-tomada', data);
  });
  
  // Estado actualizado (progreso)
  socket.on('estado-actualizado', (data) => {
    console.log(`📢 [Socket] Estado actualizado: ${data.porcentaje}%`);
    io.emit('estado-actualizado', data);
  });
  
  // Tarea lista para revisión (supervisor)
  socket.on('tarea-lista-para-revision', (data) => {
    console.log(`📢 [Socket] Tarea lista para revisión:`, data.titulo);
    io.emit('tarea-lista-para-revision', data);
  });
  
  // Tarea lista para calificar (usuario)
  socket.on('tarea-lista-para-calificar', (data) => {
    console.log(`📢 [Socket] Tarea lista para calificar:`, data.titulo);
    io.emit('tarea-lista-para-calificar', data);
  });
  
  // Tarea calificada
  socket.on('tarea-calificada', (data) => {
    console.log(`📢 [Socket] Tarea calificada: ${data.puntaje}★`);
    io.emit('tarea-calificada', data);
  });
  
  // 🔥 Tarea auto-finalizada (evento real)
  socket.on('tarea-auto-finalizada', (data) => {
    console.log(`📢 [Socket] Tarea auto-finalizada:`, data.titulo);
    io.emit('tarea-auto-finalizada', data);
  });
  
  // Estado general actualizado
  socket.on('estado-general-actualizado', (data) => {
    console.log(`📢 [Socket] Estado general actualizado:`, data.titulo);
    io.emit('estado-general-actualizado', data);
  });
  
  // Tarea iniciada
  socket.on('tarea-iniciada-tiempo-real', (data) => {
    console.log(`📢 [Socket] Tarea iniciada:`, data.tarea?.titulo);
    io.emit('tarea-iniciada-tiempo-real', data);
  });
  
  // Tarea pausada
  socket.on('tarea-pausada-tiempo-real', (data) => {
    console.log(`📢 [Socket] Tarea pausada:`, data.tareaId);
    io.emit('tarea-pausada-tiempo-real', data);
  });
  
  // Tarea reanudada
  socket.on('tarea-reanudada-tiempo-real', (data) => {
    console.log(`📢 [Socket] Tarea reanudada:`, data.tareaId);
    io.emit('tarea-reanudada-tiempo-real', data);
  });
  
  // Tarea completada automáticamente
  socket.on('tarea-completada-automaticamente', (data) => {
    console.log(`📢 [Socket] Tarea completada automáticamente:`, data.titulo);
    io.emit('tarea-completada-automaticamente', data);
  });
  
  // Tarea finalizada sin cliente
  socket.on('tarea-finalizada-sin-cliente', (data) => {
    console.log(`📢 [Socket] Tarea finalizada sin cliente:`, data.titulo);
    io.emit('tarea-finalizada-sin-cliente', data);
  });
  
  // Tarea por expirar
  socket.on('tarea-por-expirar', (data) => {
    console.log(`📢 [Socket] Tarea por expirar:`, data.titulo);
    io.emit('tarea-por-expirar', data);
  });
  
  // Tarea aprobada por supervisor
  socket.on('tarea-aprobada-por-supervisor', (data) => {
    console.log(`📢 [Socket] Tarea aprobada por supervisor:`, data.titulo);
    io.emit('tarea-aprobada-por-supervisor', data);
  });
  
  // Tarea aprobada y enviada al cliente
  socket.on('tarea-aprobada-enviada-cliente', (data) => {
    console.log(`📢 [Socket] Tarea aprobada y enviada al cliente:`, data.titulo);
    io.emit('tarea-aprobada-enviada-cliente', data);
  });
  
  // Tarea enviada a cliente
  socket.on('tarea-enviada-a-cliente', (data) => {
    console.log(`📢 [Socket] Tarea enviada a cliente:`, data.titulo);
    io.emit('tarea-enviada-a-cliente', data);
  });
  
  // Nueva tarea asignada
  socket.on('nueva-tarea-asignada', (data) => {
    console.log(`📢 [Socket] Nueva tarea asignada:`, data.tarea?.titulo);
    io.emit('nueva-tarea-asignada', data);
  });
  
  // Rol actualizado
  socket.on('rol-actualizado', (data) => {
    console.log(`📢 [Socket] Rol actualizado: ${data.nuevoRol}`);
    io.emit('rol-actualizado', data);
  });
  
  // Tarea finalizada sin calificación
  socket.on('tarea-finalizada-sin-calificacion', (data) => {
    console.log(`📢 [Socket] Tarea finalizada sin calificación:`, data.titulo);
    io.emit('tarea-finalizada-sin-calificacion', data);
  });
  
  // Tarea por revisar
  socket.on('tarea-por-revisar', (data) => {
    console.log(`📢 [Socket] Tarea por revisar:`, data.titulo);
    io.emit('tarea-por-revisar', data);
  });
  
  // ============================================================
  // DESCONEXIÓN
  // ============================================================
  socket.on('disconnect', () => {
    if (socket.userId) {
      clients.delete(socket.userId.toString());
      console.log(`👤 Usuario ${socket.userId} desconectado`);
      console.log(`   👥 Usuarios conectados: ${clients.size}`);
    } else {
      console.log('❌ Cliente desconectado sin userId:', socket.id);
    }
  });
});

// Pasar io y clients a las rutas
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    ip: LOCAL_IP,
    clients: clients.size,
    timeouts: require('./services/autoCierreService.js').timeouts?.size || 0
  });
});

// ============================================================
// MONGODB CONNECTION
// ============================================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 Servidor backend iniciado');
  console.log(`📍 Local:    http://localhost:${PORT}`);
  console.log(`📍 Red:      http://${LOCAL_IP}:${PORT}`);
  console.log(`📍 Health:   http://${LOCAL_IP}:${PORT}/api/health`);
  console.log(`🔌 Socket:   ws://${LOCAL_IP}:${PORT}/socket.io`);
  console.log('========================================');
  
  // Iniciar auto-cierre con eventos reales
  iniciarAutoCierreService(io, clients);
});

export default app;