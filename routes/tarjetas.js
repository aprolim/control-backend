import express from 'express';
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';
import { protect, supervisorOnly } from '../middleware/auth.js';
import { programarAutoFinalizacion, cancelarAutoFinalizacion } from '../services/autoCierreService.js';

const router = express.Router();

// ============================================================
// FUNCIÓN DE CÁLCULO DE PROGRESO
// ============================================================
const calcularProgresoPorTiempo = (tarjeta) => {
  if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
    return {
      porcentaje: tarjeta.porcentajeCompletado,
      tiempoTranscurrido: 0,
      tiempoRestante: 0,
      tiempoExcedido: 0,
      debeFinalizar: false
    };
  }
  
  let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
  
  if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
    const ahora = new Date();
    const inicio = new Date(tarjeta.fechaUltimaReanudacion);
    const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
    tiempoTotalTrabajado += minutosDesdeReanudacion;
  }
  
  const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
  
  let porcentaje = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
  porcentaje = Math.max(porcentaje, tarjeta.porcentajeCompletado);
  porcentaje = Math.min(100, porcentaje);
  
  const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
  const tiempoExcedido = Math.max(0, tiempoTotalTrabajado - tiempoEstimado);
  
  return {
    porcentaje,
    tiempoTranscurrido: tiempoTotalTrabajado,
    tiempoRestante,
    tiempoExcedido,
    debeFinalizar: tiempoExcedido > 5
  };
};

// ============================================================
// RUTAS
// ============================================================

router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.rol === 'tecnico') {
      query = { asignadoA: req.user._id };
    } else if (req.user.rol === 'supervisor') {
      query = {};
    } else if (req.user.rol === 'usuario') {
      query = {
        $or: [
          { 'clienteInfo.userId': req.user._id },
          { asignadoA: req.user._id }
        ]
      };
    }
    
    const tarjetas = await Tarjeta.find(query)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre')
      .sort('-createdAt');
    
    res.json(tarjetas);
  } catch (error) {
    console.error('❌ Error en GET /tarjetas:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/disponibles', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tareasDisponibles = await Tarjeta.find({
      estado: 'pendiente',
      asignadoA: null,
      tipo: 'solicitud_cliente'
    })
      .sort({ prioridad: -1, createdAt: 1 })
      .limit(20);
    
    res.json(tareasDisponibles);
  } catch (error) {
    console.error('❌ Error en GET /disponibles:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/estado-empleados', protect, async (req, res) => {
  try {
    if (req.user.rol === 'usuario') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tecnicos = await User.find({ 
      rol: 'tecnico', 
      activo: true 
    }).select('nombre email');
    
    let supervisorConTarea = null;
    if (req.user.rol === 'supervisor') {
      const tareaSupervisorActiva = await Tarjeta.findOne({
        asignadoA: req.user._id,
        estado: 'en_progreso',
        estadoProgreso: 'activa'
      }).populate('asignadoA', 'nombre email');
      
      if (tareaSupervisorActiva) {
        const { porcentaje, tiempoTranscurrido, tiempoRestante } = calcularProgresoPorTiempo(tareaSupervisorActiva);
        
        supervisorConTarea = {
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre,
          empleadoEmail: req.user.email,
          rol: 'supervisor',
          tarea: {
            id: tareaSupervisorActiva._id,
            titulo: tareaSupervisorActiva.titulo,
            descripcion: tareaSupervisorActiva.descripcion,
            porcentajeCompletado: porcentaje,
            tiempoEstimado: tareaSupervisorActiva.tiempoEstimadoEmpleado || 0,
            tiempoTranscurrido: tiempoTranscurrido,
            tiempoRestante: tiempoRestante,
            fechaInicio: tareaSupervisorActiva.fechaInicioReal,
            fechaEstimadaFin: tareaSupervisorActiva.fechaEstimadaFin,
            estadoProgreso: tareaSupervisorActiva.estadoProgreso,
            estado: tareaSupervisorActiva.estado
          }
        };
      }
    }
    
    const estados = [];
    
    for (const tecnico of tecnicos) {
      const tareaActiva = await Tarjeta.findOne({
        asignadoA: tecnico._id,
        estado: 'en_progreso',
        estadoProgreso: 'activa'
      }).populate('asignadoA', 'nombre email');
      
      if (tareaActiva) {
        const { porcentaje, tiempoTranscurrido, tiempoRestante } = calcularProgresoPorTiempo(tareaActiva);
        
        estados.push({
          empleadoId: tecnico._id,
          empleadoNombre: tecnico.nombre,
          empleadoEmail: tecnico.email,
          rol: 'tecnico',
          tarea: {
            id: tareaActiva._id,
            titulo: tareaActiva.titulo,
            descripcion: tareaActiva.descripcion,
            porcentajeCompletado: porcentaje,
            tiempoEstimado: tareaActiva.tiempoEstimadoEmpleado || 0,
            tiempoTranscurrido: tiempoTranscurrido,
            tiempoRestante: tiempoRestante,
            fechaInicio: tareaActiva.fechaInicioReal,
            fechaEstimadaFin: tareaActiva.fechaEstimadaFin,
            estadoProgreso: tareaActiva.estadoProgreso,
            estado: tareaActiva.estado
          }
        });
      } else {
        estados.push({
          empleadoId: tecnico._id,
          empleadoNombre: tecnico.nombre,
          empleadoEmail: tecnico.email,
          rol: 'tecnico',
          tarea: null
        });
      }
    }
    
    if (supervisorConTarea) {
      estados.push(supervisorConTarea);
    }
    
    res.json(estados);
  } catch (error) {
    console.error('❌ Error en estado-empleados:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PROGRESO AUTOMÁTICO
// ============================================================
router.get('/:id/progreso-automatico', protect, async (req, res) => {
  try {
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'en_progreso') {
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        tiempoExcedido: 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    if (tarjeta.estadoProgreso !== 'activa') {
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: tarjeta.tiempoEstimadoEmpleado || 0,
        tiempoExcedido: 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        tiempoExcedido: 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    
    if (tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
    }
    
    const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
    let porcentajeCalculado = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
    porcentajeCalculado = Math.max(porcentajeCalculado, tarjeta.porcentajeCompletado);
    porcentajeCalculado = Math.min(100, porcentajeCalculado);
    
    const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
    const tiempoExcedido = Math.max(0, tiempoTotalTrabajado - tiempoEstimado);
    
    res.json({
      porcentajeCalculado,
      tiempoTranscurrido: tiempoTotalTrabajado,
      tiempoRestante,
      tiempoExcedido,
      estaActiva: true,
      tiempoEstimado,
      fechaInicio: tarjeta.fechaInicioReal,
      fechaEstimadaFin: tarjeta.fechaEstimadaFin
    });
  } catch (error) {
    console.error('❌ Error en progreso-automatico:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const tarjeta = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    res.json(tarjeta);
  } catch (error) {
    console.error('❌ Error en GET /:id:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { titulo, descripcion, horasEstimadas, clienteInfo } = req.body;
    
    console.log('📝 [POST /] Creando solicitud...');
    console.log(`   📌 Título: ${titulo}`);
    console.log(`   👤 Usuario ID: ${req.user._id}`);
    
    const solicitud = await Tarjeta.create({
      titulo,
      descripcion,
      tipo: 'solicitud_cliente',
      horasEstimadas: horasEstimadas || 0,
      prioridad: clienteInfo?.logueado ? 'alta' : 'media',
      clienteInfo: {
        logueado: clienteInfo?.logueado || false,
        nombre: clienteInfo?.nombre || 'Anónimo',
        email: clienteInfo?.email,
        telefono: clienteInfo?.telefono,
        userId: req.user._id
      },
      estado: 'pendiente'
    });
    
    console.log(`✅ Solicitud creada con ID: ${solicitud._id}`);
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuarios = await User.find({ 
      rol: { $in: ['tecnico', 'supervisor'] }, 
      activo: true 
    }).select('_id nombre rol');
    
    usuarios.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('nueva-tarea-disponible', {
          tarea: solicitud,
          mensaje: `Nueva solicitud: ${solicitud.titulo}`
        });
      }
    });
    
    res.status(201).json(solicitud);
  } catch (error) {
    console.error('❌ Error en POST /:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/tarea-extra', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { titulo, descripcion, horasEstimadas, minutosEstimados } = req.body;
    
    const tareaExtra = await Tarjeta.create({
      titulo,
      descripcion,
      tipo: 'tarea_extra',
      horasEstimadas: horasEstimadas || 0,
      minutosEstimados: minutosEstimados || 0,
      asignadoA: req.user._id,
      asignadoPor: req.user._id,
      asignadaPor: 'auto',
      estado: 'en_progreso',
      prioridad: 'media',
      fechaInicio: new Date(),
      estadoProgreso: 'pausada'
    });
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tareaExtra._id }
    });
    
    res.status(201).json(tareaExtra);
  } catch (error) {
    console.error('❌ Error en POST /tarea-extra:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id/auto-asignar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA) {
      return res.status(400).json({ message: 'Tarea ya asignada' });
    }
    
    tarjeta.asignadoA = req.user._id;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'auto';
    tarjeta.estado = 'en_progreso';
    tarjeta.fechaInicio = new Date();
    tarjeta.fechaInicioReal = new Date();
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.tiempoAcumulado = 0;
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    const tareaActualizada = await Tarjeta.findById(tarjeta._id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const otrosUsuarios = await User.find({ 
      rol: { $in: ['tecnico', 'supervisor'] }, 
      _id: { $ne: req.user._id },
      activo: true 
    }).select('_id');
    
    otrosUsuarios.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-tomada', {
          tarea: tareaActualizada,
          empleado: {
            id: req.user._id,
            nombre: req.user.nombre,
            rol: req.user.rol
          },
          mensaje: `${req.user.nombre} (${req.user.rol}) tomó la tarea: ${tareaActualizada.titulo}`
        });
      }
    });
    
    res.json(tareaActualizada);
  } catch (error) {
    console.error('❌ Error en auto-asignar:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/tomar-siguiente', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarea = await Tarjeta.findOne({
      estado: 'pendiente',
      asignadoA: null,
      tipo: 'solicitud_cliente'
    }).sort({ prioridad: -1, createdAt: 1 });
    
    if (!tarea) {
      return res.status(404).json({ message: 'No hay tareas disponibles' });
    }
    
    tarea.asignadoA = req.user._id;
    tarea.asignadoPor = req.user._id;
    tarea.asignadaPor = 'auto';
    tarea.estado = 'en_progreso';
    tarea.fechaInicio = new Date();
    tarea.fechaInicioReal = new Date();
    tarea.estadoProgreso = 'pausada';
    tarea.tiempoAcumulado = 0;
    tarea.fechaUltimaReanudacion = null;
    
    await tarea.save();
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarea._id }
    });
    
    const tareaActualizada = await Tarjeta.findById(tarea._id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const socketUsuario = clients.get(req.user._id.toString());
    if (socketUsuario) {
      socketUsuario.emit('tarea-asignada', {
        tarea: tareaActualizada,
        mensaje: `Has tomado la tarea: ${tareaActualizada.titulo}`
      });
    }
    
    const otrosUsuarios = await User.find({ 
      rol: { $in: ['tecnico', 'supervisor'] }, 
      _id: { $ne: req.user._id },
      activo: true 
    }).select('_id');
    
    otrosUsuarios.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-tomada', {
          tarea: tareaActualizada,
          empleado: {
            id: req.user._id,
            nombre: req.user.nombre,
            rol: req.user.rol
          },
          mensaje: `${req.user.nombre} (${req.user.rol}) tomó la tarea: ${tareaActualizada.titulo}`
        });
      }
    });
    
    res.json({ 
      success: true, 
      tarea: tareaActualizada,
      message: 'Tarea asignada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error en tomar-siguiente:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id/tomar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA) {
      return res.status(400).json({ message: 'Tarea ya asignada' });
    }
    
    if (tarjeta.estado !== 'pendiente') {
      return res.status(400).json({ message: 'La tarea no está disponible' });
    }
    
    tarjeta.asignadoA = req.user._id;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'auto';
    tarjeta.estado = 'en_progreso';
    tarjeta.fechaInicio = new Date();
    tarjeta.fechaInicioReal = new Date();
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.tiempoAcumulado = 0;
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    const tareaActualizada = await Tarjeta.findById(tarjeta._id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const socketUsuario = clients.get(req.user._id.toString());
    if (socketUsuario) {
      socketUsuario.emit('tarea-asignada', {
        tarea: tareaActualizada,
        mensaje: `Has tomado la tarea: ${tareaActualizada.titulo}`
      });
    }
    
    const otrosUsuarios = await User.find({ 
      rol: { $in: ['tecnico', 'supervisor'] }, 
      _id: { $ne: req.user._id },
      activo: true 
    }).select('_id');
    
    otrosUsuarios.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-tomada', {
          tarea: tareaActualizada,
          empleado: {
            id: req.user._id,
            nombre: req.user.nombre,
            rol: req.user.rol
          },
          mensaje: `${req.user.nombre} (${req.user.rol}) tomó la tarea: ${tareaActualizada.titulo}`
        });
      }
    });
    
    res.json({ 
      success: true, 
      tarea: tareaActualizada,
      message: 'Tarea asignada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error en tomar específica:', error);
    res.status(500).json({ message: error.message });
  }
});

// 🔥 ASIGNAR POR SUPERVISOR
router.put('/:id/asignar-supervisor', protect, supervisorOnly, async (req, res) => {
  try {
    const { empleadoId, tiempoSugeridoHoras, tiempoSugeridoMinutos } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    const tecnico = await User.findById(empleadoId);
    if (!tecnico) {
      return res.status(404).json({ message: 'Técnico no encontrado' });
    }
    
    if (tecnico.rol !== 'tecnico') {
      return res.status(400).json({ 
        success: false,
        message: `El usuario "${tecnico.nombre}" no es un técnico. Solo se pueden asignar tareas a técnicos.`
      });
    }
    
    tarjeta.asignadoA = empleadoId;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'supervisor';
    tarjeta.estado = 'en_progreso';
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaInicio = new Date();
    tarjeta.tiempoAcumulado = 0;
    tarjeta.fechaUltimaReanudacion = null;
    
    if (tiempoSugeridoHoras || tiempoSugeridoMinutos) {
      const horas = Math.min(999, Math.max(0, parseInt(tiempoSugeridoHoras) || 0));
      const minutos = Math.min(59, Math.max(0, parseInt(tiempoSugeridoMinutos) || 0));
      const tiempoTotalMinutos = (horas * 60) + minutos;
      tarjeta.tiempoSugeridoSupervisor = tiempoTotalMinutos;
    }
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(empleadoId, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const socket = clients.get(empleadoId);
    if (socket) {
      socket.emit('nueva-tarea-asignada', {
        tarea: tarjetaActualizada,
        mensaje: `Nueva tarea asignada: ${tarjetaActualizada.titulo}`
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Tarea asignada exitosamente. El técnico debe establecer su tiempo e iniciarla.',
      tarea: tarjetaActualizada 
    });
  } catch (error) {
    console.error('❌ Error en asignar-supervisor:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
});

// 🔥 TIEMPO ESTIMADO - CON AUTO-FINALIZACIÓN
router.put('/:id/tiempo-estimado', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { tiempoEstimadoHoras, tiempoEstimadoMinutos } = req.body;
    
    const horas = parseInt(tiempoEstimadoHoras) || 0;
    const minutos = parseInt(tiempoEstimadoMinutos) || 0;
    
    if (horas > 0 && minutos > 59) {
      return res.status(400).json({ 
        message: 'Cuando hay horas, los minutos no pueden ser mayores a 59' 
      });
    }
    
    const tiempoTotalMinutos = (horas * 60) + minutos;
    
    if (tiempoTotalMinutos <= 0) {
      return res.status(400).json({ 
        message: 'El tiempo estimado debe ser mayor a 0' 
      });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (tarjeta.estadoProgreso === 'activa') {
      return res.status(400).json({ 
        message: 'No puedes modificar el tiempo mientras la tarea está activa. Pausa la tarea primero.' 
      });
    }
    
    tarjeta.tiempoEstimadoEmpleado = tiempoTotalMinutos;
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoTotalMinutos * 60 * 1000);
    
    await tarjeta.save();
    
    // 🔥 Si está pausada, reprogramar con el nuevo tiempo
    if (tarjeta.estado === 'en_progreso' && tarjeta.estadoProgreso === 'pausada') {
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const tiempoRestante = Math.max(0, tarjeta.tiempoEstimadoEmpleado - (tarjeta.tiempoAcumulado || 0));
      programarAutoFinalizacion(tarjeta._id, tiempoRestante, io, clients);
    }
    
    res.json({ 
      success: true, 
      message: 'Tiempo estimado guardado correctamente',
      tarjeta: {
        _id: tarjeta._id,
        tiempoEstimadoEmpleado: tarjeta.tiempoEstimadoEmpleado,
        fechaEstimadaFin: tarjeta.fechaEstimadaFin
      }
    });
  } catch (error) {
    console.error('❌ Error en tiempo-estimado:', error);
    res.status(500).json({ message: error.message });
  }
});

// 🔥 INICIAR TAREA - Programar auto-finalización
router.put('/:id/iniciar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado === 0) {
      return res.status(400).json({ 
        message: 'Debes establecer un tiempo estimado antes de iniciar la tarea.' 
      });
    }
    
    // Pausar otras tareas activas del mismo técnico
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa', _id: { $ne: req.params.id } },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    tarjeta.fechaInicioReal = new Date();
    tarjeta.fechaUltimaReanudacion = new Date();
    tarjeta.estadoProgreso = 'activa';
    tarjeta.estado = 'en_progreso';
    
    await tarjeta.save();
    
    // 🔥 PROGRAMAR AUTO-FINALIZACIÓN
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    programarAutoFinalizacion(tarjeta._id, tarjeta.tiempoEstimadoEmpleado, io, clients);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    // Notificar por socket
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['supervisor', 'tecnico'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-iniciada-tiempo-real', {
          tarea: {
            id: tarjeta._id,
            titulo: tarjeta.titulo,
            tiempoEstimado: tarjeta.tiempoEstimadoEmpleado,
            fechaEstimadaFin: tarjeta.fechaEstimadaFin
          },
          empleado: {
            id: req.user._id,
            nombre: req.user.nombre,
            rol: req.user.rol
          }
        });
      }
    });
    
    res.json(tarjetaActualizada);
  } catch (error) {
    console.error('❌ Error en iniciar:', error);
    res.status(500).json({ message: error.message });
  }
});

// 🔥 PAUSAR TAREA - Cancelar auto-finalización
router.put('/:id/pausar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // Calcular tiempo trabajado
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosTrabajados = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosTrabajados;
    }
    
    tarjeta.tiempoAcumulado = tiempoTotalTrabajado;
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    
    // 🔥 CANCELAR AUTO-FINALIZACIÓN
    cancelarAutoFinalizacion(tarjeta._id);
    
    // Notificar por socket
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['supervisor', 'tecnico'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-pausada-tiempo-real', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre
        });
      }
    });
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    console.error('❌ Error en pausar:', error);
    res.status(500).json({ message: error.message });
  }
});

// 🔥 REANUDAR TAREA - Reprogramar auto-finalización
router.put('/:id/reanudar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado === 0) {
      return res.status(400).json({ 
        message: 'Debes establecer un tiempo estimado antes de reanudar' 
      });
    }
    
    // Pausar otras tareas activas
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa' },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    tarjeta.estadoProgreso = 'activa';
    tarjeta.fechaUltimaReanudacion = new Date();
    await tarjeta.save();
    
    // 🔥 REPROGRAMAR AUTO-FINALIZACIÓN
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const tiempoRestante = Math.max(0, tarjeta.tiempoEstimadoEmpleado - (tarjeta.tiempoAcumulado || 0));
    programarAutoFinalizacion(tarjeta._id, tiempoRestante, io, clients);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    // Notificar por socket
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['supervisor', 'tecnico'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-reanudada-tiempo-real', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre
        });
      }
    });
    
    res.json({ success: true, tarjeta: tarjetaActualizada });
  } catch (error) {
    console.error('❌ Error en reanudar:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id/progreso', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { porcentajeAvance, comentario } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (tarjeta.estado !== 'en_progreso') {
      return res.status(400).json({ message: 'La tarea no está en progreso' });
    }
    
    let tiempoTotalMinutos = tarjeta.tiempoAcumulado || 0;
    
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalMinutos += minutosDesdeReanudacion;
    }
    
    const horasTrabajadas = Math.floor(tiempoTotalMinutos / 60);
    const minutosTrabajados = tiempoTotalMinutos % 60;
    
    const registro = {
      fecha: new Date(),
      horasTrabajadas: horasTrabajadas,
      minutosTrabajados: minutosTrabajados,
      porcentajeAvance: parseInt(porcentajeAvance) || 0,
      comentario: comentario || '',
      inicioTrabajo: new Date(),
      finTrabajo: new Date(),
      cruzoMedianoche: false,
      esHoraExtra: false
    };
    
    tarjeta.registroHoras.push(registro);
    tarjeta.porcentajeCompletado = parseInt(porcentajeAvance) || 0;
    
    const horasActuales = tarjeta.horasTotalesReales || 0;
    const minutosActuales = tarjeta.minutosTotalesReales || 0;
    const totalMinutosActuales = (horasActuales * 60) + minutosActuales;
    const nuevosTotalMinutos = totalMinutosActuales + tiempoTotalMinutos;
    
    tarjeta.horasTotalesReales = Math.floor(nuevosTotalMinutos / 60);
    tarjeta.minutosTotalesReales = nuevosTotalMinutos % 60;
    
    if (tarjeta.estadoProgreso === 'activa') {
      tarjeta.tiempoAcumulado = 0;
      tarjeta.fechaUltimaReanudacion = new Date();
    }
    
    if (parseInt(porcentajeAvance) >= 100 && tarjeta.estado === 'en_progreso') {
      tarjeta.fechaCompletadaEmpleado = new Date();
      tarjeta.estado = 'revision_supervisor';
      tarjeta.fechaRevisionSupervisor = new Date();
      tarjeta.revisionSupervisor = 'pendiente';
      tarjeta.fechaExpiracionRevisionSupervisor = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tarjeta.estadoProgreso = 'completada';
      
      // Cancelar auto-finalización si existe
      cancelarAutoFinalizacion(tarjeta._id);
      
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
      supervisores.forEach(supervisor => {
        const socket = clients.get(supervisor._id.toString());
        if (socket) {
          socket.emit('tarea-lista-para-revision', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            empleadoId: req.user._id,
            empleadoNombre: req.user.nombre
          });
        }
      });
      
      if (tarjeta.asignadoA) {
        await User.findByIdAndUpdate(tarjeta.asignadoA, {
          $pull: { tareasActivas: tarjeta._id }
        });
      }
    }
    
    await tarjeta.save();
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['supervisor', 'tecnico'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('estado-actualizado', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre,
          porcentaje: tarjeta.porcentajeCompletado,
          estado: tarjeta.estado
        });
      }
    });
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    console.error('❌ Error en progreso:', error);
    res.status(500).json({ message: error.message });
  }
});

// 🔥 APROBAR POR SUPERVISOR
router.put('/:id/aprobar-supervisor', protect, supervisorOnly, async (req, res) => {
  try {
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'revision_supervisor') {
      return res.status(400).json({ message: 'Esta tarea no está pendiente de aprobación' });
    }
    
    const esSolicitudCliente = tarjeta.tipo === 'solicitud_cliente' && tarjeta.clienteInfo?.userId;
    
    tarjeta.revisionSupervisor = 'aprobada';
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    if (esSolicitudCliente) {
      tarjeta.estado = 'revision_cliente';
      tarjeta.fechaRevisionCliente = new Date();
      tarjeta.estadoCalificacion = 'pendiente';
      tarjeta.fechaExpiracionCalificacion = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      
      await tarjeta.save();
      
      if (tarjeta.clienteInfo?.userId) {
        const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
        if (socketCliente) {
          socketCliente.emit('tarea-lista-para-calificar', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: 'Tu tarea está lista para ser calificada'
          });
        }
      }
      
      const socketSupervisor = clients.get(req.user._id.toString());
      if (socketSupervisor) {
        socketSupervisor.emit('tarea-aprobada-enviada-cliente', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: `✅ Tarea "${tarjeta.titulo}" aprobada y enviada al cliente para calificación`
        });
      }
      
      const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
      supervisores.forEach(supervisor => {
        if (supervisor._id.toString() !== req.user._id.toString()) {
          const socket = clients.get(supervisor._id.toString());
          if (socket) {
            socket.emit('tarea-enviada-a-cliente', {
              tareaId: tarjeta._id,
              titulo: tarjeta.titulo,
              mensaje: `Tarea "${tarjeta.titulo}" enviada al cliente para calificación`
            });
          }
        }
      });
      
      if (tarjeta.asignadoA) {
        const socketTecnico = clients.get(tarjeta.asignadoA.toString());
        if (socketTecnico) {
          socketTecnico.emit('tarea-aprobada-por-supervisor', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: `✅ Tarea "${tarjeta.titulo}" aprobada por el supervisor. Esperando calificación del usuario.`
          });
        }
      }
      
      const todosUsuarios = await User.find({ activo: true }).select('_id');
      todosUsuarios.forEach(usuario => {
        const socket = clients.get(usuario._id.toString());
        if (socket) {
          socket.emit('estado-general-actualizado', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            estado: tarjeta.estado,
            porcentaje: tarjeta.porcentajeCompletado,
            accion: 'aprobada-enviada-cliente'
          });
        }
      });
      
    } else {
      tarjeta.estado = 'finalizada';
      tarjeta.fechaFinalizada = new Date();
      tarjeta.estadoCalificacion = 'no_aplica';
      await tarjeta.save();
      
      if (tarjeta.asignadoA) {
        const socketEmpleado = clients.get(tarjeta.asignadoA.toString());
        if (socketEmpleado) {
          socketEmpleado.emit('tarea-finalizada-sin-cliente', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: '✅ Tarea aprobada y finalizada'
          });
        }
      }
      
      const socketSupervisor = clients.get(req.user._id.toString());
      if (socketSupervisor) {
        socketSupervisor.emit('tarea-finalizada-sin-cliente', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: `✅ Tarea "${tarjeta.titulo}" aprobada y finalizada`
        });
      }
      
      const todosUsuarios = await User.find({ activo: true }).select('_id');
      todosUsuarios.forEach(usuario => {
        const socket = clients.get(usuario._id.toString());
        if (socket) {
          socket.emit('estado-general-actualizado', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            estado: tarjeta.estado,
            porcentaje: tarjeta.porcentajeCompletado,
            accion: 'finalizada'
          });
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: esSolicitudCliente ? 'Tarea enviada a revisión del usuario' : 'Tarea finalizada',
      tarjeta 
    });
    
  } catch (error) {
    console.error('❌ Error en aprobar-supervisor:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id/calificar', protect, async (req, res) => {
  try {
    const { puntaje, comentario } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'revision_cliente') {
      return res.status(400).json({ message: 'Esta tarea no está pendiente de calificación' });
    }
    
    if (tarjeta.clienteInfo.userId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No puedes calificar esta tarea' });
    }
    
    tarjeta.calificacion = {
      puntaje,
      comentario: comentario || '',
      fecha: new Date(),
      clienteId: req.user._id
    };
    tarjeta.estado = 'finalizada';
    tarjeta.fechaFinalizada = new Date();
    tarjeta.estadoCalificacion = 'calificada';
    
    await tarjeta.save();
    
    if (tarjeta.asignadoA) {
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const socketEmpleado = clients.get(tarjeta.asignadoA.toString());
      if (socketEmpleado) {
        socketEmpleado.emit('tarea-calificada', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          puntaje,
          comentario
        });
      }
    }
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    console.error('❌ Error en calificar:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
