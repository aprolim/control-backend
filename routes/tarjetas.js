// routes/tarjetas.js
import express from 'express';
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';
import { protect, supervisorOnly } from '../middleware/auth.js';
import { 
  programarAutoFinalizacion, 
  cancelarAutoFinalizacion,
  registrarLogTiempo,
  recalcularTiempoPorProgreso
} from '../services/autoCierreService.js';

const router = express.Router();

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

const calcularEficiencia = (tiempoEstimado, tiempoReal) => {
  if (!tiempoEstimado || tiempoEstimado <= 0) return 'esperado';
  const diferencia = ((tiempoReal - tiempoEstimado) / tiempoEstimado) * 100;
  if (diferencia <= -20) return 'mayor_a_esperado';
  if (diferencia <= 20) return 'esperado';
  if (diferencia <= 50) return 'menor_a_esperado';
  return 'critico';
};

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

const calcularTiempoRestante = (tarjeta) => {
  const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado || 0;
  const tiempoTrabajado = tarjeta.tiempoAcumulado || 0;
  return Math.max(0, tiempoEstimado - tiempoTrabajado);
};

// ============================================================
// HELPER: Notificar al cliente dueño de la tarea
// ============================================================
const notificarClienteDuenio = (clients, tarjeta, empleado, mensaje) => {
  if (!tarjeta?.clienteInfo?.userId) return false;
  
  const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
  if (!socketCliente) return false;
  
  console.log(`   📢 Notificando al CLIENTE dueño: ${tarjeta.clienteInfo.nombre || 'Anónimo'}`);
  socketCliente.emit('tarea-tomada', {
    tarea: tarjeta,
    empleado: {
      id: empleado._id,
      nombre: empleado.nombre,
      rol: empleado.rol
    },
    mensaje
  });
  return true;
};

// ============================================================
// GET - CONSULTAS
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
            tiempoAcumulado: tareaSupervisorActiva.tiempoAcumulado || 0,
            fechaUltimaReanudacion: tareaSupervisorActiva.fechaUltimaReanudacion,
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
            tiempoAcumulado: tareaActiva.tiempoAcumulado || 0,
            fechaUltimaReanudacion: tareaActiva.fechaUltimaReanudacion,
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

router.get('/:id/logs', protect, async (req, res) => {
  try {
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    res.json({
      success: true,
      logs: tarjeta.logTiempos || [],
      total: tarjeta.logTiempos?.length || 0
    });
  } catch (error) {
    console.error('❌ Error en GET /logs:', error);
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

// ============================================================
// POST - CREAR SOLICITUD / TAREA EXTRA
// ============================================================

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
      estado: 'pendiente',
      logTiempos: []
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
        
        if (usuario.rol === 'tecnico') {
          socket.emit('notificacion-nueva-pendiente', {
            tarea: {
              _id: solicitud._id,
              titulo: solicitud.titulo,
              descripcion: solicitud.descripcion,
              prioridad: solicitud.prioridad
            },
            mensaje: `📋 Nueva tarea pendiente: "${solicitud.titulo}"`
          });
        }
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
      estadoProgreso: 'pausada',
      logTiempos: []
    });
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tareaExtra._id }
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const socketPropio = clients.get(req.user._id.toString());
    if (socketPropio) {
      socketPropio.emit('notificacion-tarea-asignada', {
        tarea: {
          _id: tareaExtra._id,
          titulo: tareaExtra.titulo,
          descripcion: tareaExtra.descripcion,
          prioridad: tareaExtra.prioridad
        },
        asignadaPor: 'Tú mismo',
        mensaje: `📌 Creaste una tarea extra: "${tareaExtra.titulo}"`
      });
    }
    
    res.status(201).json(tareaExtra);
  } catch (error) {
    console.error('❌ Error en POST /tarea-extra:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT - DEVOLVER / REASIGNAR
// ============================================================

router.put('/:id/devolver', protect, async (req, res) => {
  try {
    const { motivo } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id).populate('asignadoA', 'nombre email');
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No eres el técnico asignado a esta tarea' });
    }
    
    if (tarjeta.estado !== 'en_progreso') {
      return res.status(400).json({ message: 'La tarea no está en progreso' });
    }
    
    if (tarjeta.tiempoEstimadoEmpleado > 0) {
      return res.status(400).json({ 
        message: 'No puedes devolver una tarea que ya tiene tiempo estimado. Si no puedes completarla, contacta a tu supervisor.' 
      });
    }
    
    const tecnicoNombre = tarjeta.asignadoA?.nombre || 'Desconocido';
    const clienteAnteriorId = tarjeta.clienteInfo?.userId;
    
    tarjeta.estado = 'pendiente';
    tarjeta.asignadoA = null;
    tarjeta.asignadoPor = null;
    tarjeta.estadoProgreso = 'pendiente';
    tarjeta.tiempoAcumulado = 0;
    tarjeta.tiempoPausadoTotal = 0;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.fechaInicioReal = null;
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { tareasActivas: tarjeta._id }
    });
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_devuelta',
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: motivo || 'Sin tiempo estimado establecido'
    });
    
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
          tarea: tarjeta,
          mensaje: `📋 Tarea "${tarjeta.titulo}" está disponible (devuelta por ${tecnicoNombre})`
        });
        
        if (usuario.rol === 'tecnico') {
          socket.emit('notificacion-nueva-pendiente', {
            tarea: {
              _id: tarjeta._id,
              titulo: tarjeta.titulo,
              descripcion: tarjeta.descripcion,
              prioridad: tarjeta.prioridad
            },
            mensaje: `📋 Tarea disponible: "${tarjeta.titulo}"`
          });
        }
      }
    });
    
    // 🔥 NUEVO: Notificar al cliente dueño que la tarea volvió a estar pendiente
    if (clienteAnteriorId) {
      const socketCliente = clients.get(clienteAnteriorId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-tomada', {
          tarea: tarjeta,
          empleado: null,
          mensaje: `Tu tarea "${tarjeta.titulo}" volvió a estar pendiente (devuelta por ${tecnicoNombre})`
        });
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Tarea devuelta exitosamente',
      tarjeta 
    });
    
  } catch (error) {
    console.error('❌ Error en devolver:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id/reasignar', protect, supervisorOnly, async (req, res) => {
  try {
    const { nuevoEmpleadoId, motivo } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email');
    
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'en_progreso' && tarjeta.estado !== 'pendiente') {
      return res.status(400).json({ message: 'La tarea no está disponible para reasignar' });
    }
    
    const tecnicoAnterior = tarjeta.asignadoA;
    const tecnicoAnteriorNombre = tecnicoAnterior?.nombre || 'Sin asignar';
    
    if (tecnicoAnterior) {
      await User.findByIdAndUpdate(tecnicoAnterior._id, {
        $pull: { tareasActivas: tarjeta._id }
      });
      
      if (tarjeta.estadoProgreso === 'activa') {
        cancelarAutoFinalizacion(tarjeta._id);
      }
    }
    
    const nuevoTecnico = await User.findById(nuevoEmpleadoId);
    if (!nuevoTecnico) {
      return res.status(404).json({ message: 'Técnico no encontrado' });
    }
    
    if (nuevoTecnico.rol !== 'tecnico') {
      return res.status(400).json({ 
        message: `El usuario "${nuevoTecnico.nombre}" no es un técnico` 
      });
    }
    
    tarjeta.asignadoA = nuevoEmpleadoId;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'supervisor';
    tarjeta.estado = 'en_progreso';
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.tiempoAcumulado = 0;
    tarjeta.tiempoPausadoTotal = 0;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.fechaUltimaReanudacion = null;
    tarjeta.fechaInicioReal = null;
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(nuevoEmpleadoId, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_reasignada',
      por: req.user.nombre,
      rol: 'supervisor',
      motivo: motivo || 'Reasignación por supervisor',
      tecnicoAnterior: tecnicoAnteriorNombre,
      tecnicoNuevo: nuevoTecnico.nombre
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const socketNuevo = clients.get(nuevoEmpleadoId.toString());
    if (socketNuevo) {
      socketNuevo.emit('nueva-tarea-asignada', {
        tarea: tarjeta,
        mensaje: `📋 Tarea "${tarjeta.titulo}" te ha sido reasignada`
      });
      
      socketNuevo.emit('notificacion-tarea-asignada', {
        tarea: {
          _id: tarjeta._id,
          titulo: tarjeta.titulo,
          descripcion: tarjeta.descripcion,
          prioridad: tarjeta.prioridad
        },
        asignadaPor: req.user.nombre,
        mensaje: `📌 ${req.user.nombre} te reasignó: "${tarjeta.titulo}"`
      });
    }
    
    if (tecnicoAnterior) {
      const socketAnterior = clients.get(tecnicoAnterior._id.toString());
      if (socketAnterior) {
        socketAnterior.emit('tarea-reasignada', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: `📋 La tarea "${tarjeta.titulo}" ha sido reasignada a ${nuevoTecnico.nombre}`
        });
      }
    }
    
    // 🔥 NUEVO: Notificar al cliente dueño de la reasignación
    notificarClienteDuenio(
      clients,
      tarjeta,
      nuevoTecnico,
      `Tu tarea "${tarjeta.titulo}" fue reasignada a ${nuevoTecnico.nombre}`
    );
    
    res.json({ 
      success: true, 
      message: 'Tarea reasignada exitosamente',
      tarjeta 
    });
    
  } catch (error) {
    console.error('❌ Error en reasignar:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT - FINALIZAR TAREA (TÉCNICO)
// ============================================================

router.put('/:id/finalizar', protect, async (req, res) => {
  try {
    const { comentario } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id).populate('asignadoA', 'nombre email');
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No eres el técnico asignado a esta tarea' });
    }
    
    if (tarjeta.estado !== 'en_progreso') {
      return res.status(400).json({ message: 'La tarea no está en progreso' });
    }
    
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
    }
    
    const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado || 0;
    const diferencia = tiempoTotalTrabajado - tiempoEstimado;
    const eficiencia = calcularEficiencia(tiempoEstimado, tiempoTotalTrabajado);
    
    console.log(`✅ FINALIZANDO TAREA (directo): ${tarjeta.titulo}`);
    console.log(`   Tiempo estimado: ${tiempoEstimado} min`);
    console.log(`   Tiempo real: ${tiempoTotalTrabajado} min`);
    console.log(`   Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia} min`);
    console.log(`   Eficiencia: ${eficiencia}`);
    
    tarjeta.estado = 'finalizada';
    tarjeta.fechaCompletadaEmpleado = new Date();
    tarjeta.fechaFinalizada = new Date();
    tarjeta.estadoProgreso = 'completada';
    tarjeta.porcentajeCompletado = 100;
    tarjeta.tiempoAcumulado = tiempoTotalTrabajado;
    tarjeta.estadoCalificacion = 'pendiente';
    tarjeta.fechaUltimaPausa = null;
    
    const horasReales = Math.floor(tiempoTotalTrabajado / 60);
    const minutosReales = tiempoTotalTrabajado % 60;
    tarjeta.horasTotalesReales = horasReales;
    tarjeta.minutosTotalesReales = minutosReales;
    
    await tarjeta.save();
    
    cancelarAutoFinalizacion(tarjeta._id);
    
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { tareasActivas: tarjeta._id }
    });
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_finalizada',
      tiempoMinutos: tiempoEstimado,
      tiempoReal: tiempoTotalTrabajado,
      diferencia: diferencia,
      eficiencia: eficiencia,
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: comentario || 'Tarea completada manualmente'
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const socketTecnico = clients.get(req.user._id.toString());
    if (socketTecnico) {
      socketTecnico.emit('tarea-finalizada-por-ti', {
        tareaId: tarjeta._id,
        titulo: tarjeta.titulo,
        mensaje: `✅ Tarea "${tarjeta.titulo}" finalizada`
      });
    }
    
    if (tarjeta.clienteInfo?.userId) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-finalizada-por-ti', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: `✅ Tu tarea "${tarjeta.titulo}" ha sido finalizada. Puedes calificarla cuando quieras.`
        });
      }
    }
    
    io.emit('estado-general-actualizado', {
      tareaId: tarjeta._id,
      titulo: tarjeta.titulo,
      estado: tarjeta.estado,
      porcentaje: 100,
      empleadoId: req.user._id,
      mensaje: `Tarea "${tarjeta.titulo}" finalizada por ${req.user.nombre}`
    });
    
    res.json({ 
      success: true, 
      message: 'Tarea finalizada exitosamente',
      tarjeta,
      eficiencia,
      tiempoReal: tiempoTotalTrabajado
    });
    
  } catch (error) {
    console.error('❌ Error en finalizar:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT - ASIGNACIÓN
// ============================================================

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
    tarjeta.tiempoPausadoTotal = 0;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_iniciada',
      por: req.user.nombre,
      rol: req.user.rol,
      motivo: 'Tarea auto-asignada'
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
    }).select('_id nombre rol');
    
    console.log('========================================');
    console.log(`📤 [auto-asignar] Notificando a ${otrosUsuarios.length} usuarios sobre tarea tomada`);
    console.log(`   📋 Tarea: ${tareaActualizada.titulo}`);
    console.log(`   👤 Tomada por: ${req.user.nombre} (${req.user.rol})`);
    console.log(`   📊 Total clients conectados: ${clients.size}`);
    
    otrosUsuarios.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        console.log(`   ✅ Notificando a ${usuario.nombre} (${usuario.rol})`);
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
    console.log('========================================');
    
    // 🔥 NUEVO: Notificar al CLIENTE dueño de la tarea
    notificarClienteDuenio(
      clients,
      tareaActualizada,
      req.user,
      `${req.user.nombre} tomó tu tarea: ${tareaActualizada.titulo}`
    );
    
    const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
    supervisores.forEach(sup => {
      const socketSup = clients.get(sup._id.toString());
      if (socketSup) {
        socketSup.emit('kanban-actualizar', {
          tareaId: tareaActualizada._id,
          tarea: tareaActualizada,
          accion: 'tarea-tomada',
          mensaje: `📋 Nueva tarea asignada: ${tareaActualizada.titulo}`
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
    tarea.tiempoPausadoTotal = 0;
    tarea.fechaUltimaPausa = null;
    tarea.fechaUltimaReanudacion = null;
    
    await tarea.save();
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarea._id }
    });
    
    await registrarLogTiempo(tarea._id, {
      tipo: 'tarea_iniciada',
      por: req.user.nombre,
      rol: req.user.rol,
      motivo: 'Tarea tomada (siguiente disponible)'
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
    }).select('_id nombre rol');
    
    console.log('========================================');
    console.log(`📤 [tomar-siguiente] Notificando a ${otrosUsuarios.length} usuarios`);
    console.log(`   📋 Tarea: ${tareaActualizada.titulo}`);
    console.log(`   👤 Tomada por: ${req.user.nombre} (${req.user.rol})`);
    
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
    console.log('========================================');
    
    // 🔥 NUEVO: Notificar al CLIENTE dueño de la tarea
    notificarClienteDuenio(
      clients,
      tareaActualizada,
      req.user,
      `${req.user.nombre} tomó tu tarea: ${tareaActualizada.titulo}`
    );
    
    const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
    supervisores.forEach(sup => {
      const socketSup = clients.get(sup._id.toString());
      if (socketSup) {
        socketSup.emit('kanban-actualizar', {
          tareaId: tareaActualizada._id,
          tarea: tareaActualizada,
          accion: 'tarea-tomada',
          mensaje: `📋 Nueva tarea asignada: ${tareaActualizada.titulo}`
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
    tarjeta.tiempoPausadoTotal = 0;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(req.user._id, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_iniciada',
      por: req.user.nombre,
      rol: req.user.rol,
      motivo: 'Tarea tomada específicamente'
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
    
    // 🔥 NUEVO: Notificar al CLIENTE dueño de la tarea
    notificarClienteDuenio(
      clients,
      tareaActualizada,
      req.user,
      `${req.user.nombre} tomó tu tarea: ${tareaActualizada.titulo}`
    );
    
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
        message: `El usuario "${tecnico.nombre}" no es un técnico.`
      });
    }
    
    tarjeta.asignadoA = empleadoId;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'supervisor';
    tarjeta.estado = 'en_progreso';
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaInicio = new Date();
    tarjeta.tiempoAcumulado = 0;
    tarjeta.tiempoPausadoTotal = 0;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.fechaUltimaReanudacion = null;
    
    let tiempoSugerido = 0;
    if (tiempoSugeridoHoras || tiempoSugeridoMinutos) {
      const horas = Math.min(999, Math.max(0, parseInt(tiempoSugeridoHoras) || 0));
      const minutos = Math.min(59, Math.max(0, parseInt(tiempoSugeridoMinutos) || 0));
      tiempoSugerido = (horas * 60) + minutos;
      tarjeta.tiempoSugeridoSupervisor = tiempoSugerido;
    }
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(empleadoId, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    if (tiempoSugerido > 0) {
      await registrarLogTiempo(tarjeta._id, {
        tipo: 'sugerido_supervisor',
        tiempoMinutos: tiempoSugerido,
        por: req.user.nombre,
        rol: 'supervisor',
        motivo: `Tiempo sugerido por supervisor`
      });
    }
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_iniciada',
      por: req.user.nombre,
      rol: 'supervisor',
      motivo: `Asignada a ${tecnico.nombre}`
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
      
      socket.emit('notificacion-tarea-asignada', {
        tarea: {
          _id: tarjetaActualizada._id,
          titulo: tarjetaActualizada.titulo,
          descripcion: tarjetaActualizada.descripcion,
          prioridad: tarjetaActualizada.prioridad
        },
        asignadaPor: req.user.nombre,
        mensaje: `📌 ${req.user.nombre} te asignó: "${tarjetaActualizada.titulo}"`
      });
      
      console.log(`   🔔 Notificación sonora enviada a ${tecnico.nombre}`);
    }
    
    // 🔥 NUEVO: Notificar al CLIENTE dueño de la tarea
    notificarClienteDuenio(
      clients,
      tarjetaActualizada,
      tecnico,
      `${req.user.nombre} asignó tu tarea a ${tecnico.nombre}`
    );
    
    const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
    supervisores.forEach(sup => {
      const socketSup = clients.get(sup._id.toString());
      if (socketSup) {
        socketSup.emit('kanban-actualizar', {
          tareaId: tarjetaActualizada._id,
          tarea: tarjetaActualizada,
          accion: 'asignada-supervisor',
          mensaje: `📋 Tarea asignada a ${tecnico.nombre}: ${tarjetaActualizada.titulo}`
        });
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Tarea asignada exitosamente',
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

// ============================================================
// PUT - TIEMPO ESTIMADO
// ============================================================

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
    
    const tiempoAnterior = tarjeta.tiempoEstimadoEmpleado || 0;
    const diferencia = tiempoTotalMinutos - tiempoAnterior;
    
    tarjeta.tiempoEstimadoEmpleado = tiempoTotalMinutos;
    
    const tiempoRestante = Math.max(0, tiempoTotalMinutos - (tarjeta.tiempoAcumulado || 0));
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoRestante * 60 * 1000);
    
    await tarjeta.save();
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'estimado_tecnico',
      tiempoMinutos: tiempoTotalMinutos,
      tiempoAnterior: tiempoAnterior,
      diferencia: diferencia,
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: req.body.motivo || 'Estimación inicial del técnico',
      tiempoRestante: tiempoTotalMinutos
    });
    
    if (tarjeta.estado === 'en_progreso' && tarjeta.estadoProgreso === 'pausada') {
      const io = req.app.get('io');
      const clients = req.app.get('clients');
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

// ============================================================
// PUT - PROGRESO
// ============================================================

router.put('/:id/progreso', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { porcentajeAvance, comentario } = req.body;
    
    if (!comentario || comentario.trim().length < 5) {
      return res.status(400).json({ 
        success: false,
        message: 'El comentario es obligatorio (mínimo 5 caracteres) para que el supervisor entienda el motivo del avance.' 
      });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id).populate('asignadoA', 'nombre email');
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?._id.toString() !== req.user._id.toString()) {
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
      comentario: comentario.trim(),
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
      tarjeta.estado = 'finalizada';
      tarjeta.fechaFinalizada = new Date();
      tarjeta.estadoProgreso = 'completada';
      tarjeta.estadoCalificacion = 'pendiente';
      tarjeta.fechaUltimaPausa = null;
      
      cancelarAutoFinalizacion(tarjeta._id);
      
      await registrarLogTiempo(tarjeta._id, {
        tipo: 'tarea_finalizada',
        tiempoReal: tiempoTotalMinutos,
        por: req.user.nombre,
        rol: 'tecnico',
        motivo: comentario.trim(),
        eficiencia: 'esperado'
      });
      
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      
      const socketTecnico = clients.get(req.user._id.toString());
      if (socketTecnico) {
        socketTecnico.emit('tarea-finalizada-por-ti', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: `✅ Tarea "${tarjeta.titulo}" finalizada`
        });
      }
      
      if (tarjeta.clienteInfo?.userId) {
        const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
        if (socketCliente) {
          socketCliente.emit('tarea-finalizada-por-ti', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: `✅ Tu tarea "${tarjeta.titulo}" ha sido finalizada. Puedes calificarla cuando quieras.`
          });
        }
      }
      
      io.emit('estado-general-actualizado', {
        tareaId: tarjeta._id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        porcentaje: 100,
        empleadoId: req.user._id,
        mensaje: `Tarea "${tarjeta.titulo}" finalizada por ${req.user.nombre}`
      });
      
      if (tarjeta.asignadoA) {
        await User.findByIdAndUpdate(tarjeta.asignadoA, {
          $pull: { tareasActivas: tarjeta._id }
        });
      }
      
      await tarjeta.save();
      
      res.json({ 
        success: true, 
        tarjeta,
        completada: true,
        mensaje: '🎉 Tarea completada'
      });
      return;
    }
    
    await tarjeta.save();
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const resultadoRecalculo = await recalcularTiempoPorProgreso(
      tarjeta._id, 
      io, 
      clients, 
      comentario.trim()
    );
    
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
          estado: tarjeta.estado,
          tiempoRecalculado: resultadoRecalculo?.nuevoEstimado || null
        });
      }
    });
    
    // 🔥 NUEVO: Notificar al CLIENTE que su tarea tuvo progreso
    if (tarjeta.clienteInfo?.userId) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('estado-actualizado', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre,
          porcentaje: tarjeta.porcentajeCompletado,
          estado: tarjeta.estado
        });
      }
    }
    
    res.json({ 
      success: true, 
      tarjeta,
      recalculado: resultadoRecalculo
    });
  } catch (error) {
    console.error('❌ Error en progreso:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT - INICIAR / PAUSAR / REANUDAR
// ============================================================

router.put('/:id/iniciar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'tecnico' && req.user.rol !== 'supervisor') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id).populate('asignadoA', 'nombre email');
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado === 0) {
      return res.status(400).json({ 
        message: 'Debes establecer un tiempo estimado antes de iniciar la tarea.' 
      });
    }
    
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa', _id: { $ne: req.params.id } },
      { 
        estadoProgreso: 'pausada', 
        fechaUltimaPausa: new Date(),
        fechaUltimaReanudacion: null 
      }
    );
    
    tarjeta.fechaInicioReal = new Date();
    tarjeta.fechaUltimaReanudacion = new Date();
    tarjeta.fechaUltimaPausa = null;
    tarjeta.estadoProgreso = 'activa';
    tarjeta.estado = 'en_progreso';
    
    await tarjeta.save();
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_iniciada',
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: 'Tarea iniciada (comenzó a trabajar)'
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const tiempoRestante = calcularTiempoRestante(tarjeta);
    programarAutoFinalizacion(tarjeta._id, tiempoRestante, io, clients);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
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
    
    // 🔥 NUEVO: Notificar al CLIENTE
    if (tarjeta.clienteInfo?.userId) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-iniciada-tiempo-real', {
          tarea: {
            id: tarjeta._id,
            titulo: tarjeta.titulo
          },
          empleado: {
            id: req.user._id,
            nombre: req.user.nombre,
            rol: req.user.rol
          }
        });
      }
    }
    
    res.json(tarjetaActualizada);
  } catch (error) {
    console.error('❌ Error en iniciar:', error);
    res.status(500).json({ message: error.message });
  }
});

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
    
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosTrabajados = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosTrabajados;
    }
    
    tarjeta.tiempoAcumulado = tiempoTotalTrabajado;
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaUltimaPausa = new Date();
    tarjeta.fechaUltimaReanudacion = null;
    
    await tarjeta.save();
    
    cancelarAutoFinalizacion(tarjeta._id);
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_pausada',
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: 'Tarea pausada',
      tiempoTrabajado: tiempoTotalTrabajado
    });
    
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
    
    // 🔥 NUEVO: Notificar al CLIENTE
    if (tarjeta.clienteInfo?.userId) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-pausada-tiempo-real', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre
        });
      }
    }
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    console.error('❌ Error en pausar:', error);
    res.status(500).json({ message: error.message });
  }
});

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
    
    let tiempoPausadoReciente = 0;
    if (tarjeta.fechaUltimaPausa) {
      const ahora = new Date();
      const pausa = new Date(tarjeta.fechaUltimaPausa);
      tiempoPausadoReciente = Math.floor((ahora - pausa) / 1000 / 60);
      tarjeta.tiempoPausadoTotal = (tarjeta.tiempoPausadoTotal || 0) + tiempoPausadoReciente;
    }
    
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa', _id: { $ne: req.params.id } },
      { 
        estadoProgreso: 'pausada', 
        fechaUltimaPausa: new Date(),
        fechaUltimaReanudacion: null 
      }
    );
    
    tarjeta.estadoProgreso = 'activa';
    tarjeta.fechaUltimaReanudacion = new Date();
    tarjeta.fechaUltimaPausa = null;
    
    const tiempoRestante = calcularTiempoRestante(tarjeta);
    if (tiempoRestante > 0) {
      tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoRestante * 60 * 1000);
    }
    
    await tarjeta.save();
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_reanudada',
      por: req.user.nombre,
      rol: 'tecnico',
      motivo: `Tarea reanudada (pausada ${tiempoPausadoReciente} min)`,
      tiempoTrabajado: tiempoPausadoReciente
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    programarAutoFinalizacion(tarjeta._id, tiempoRestante, io, clients);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
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
          empleadoNombre: req.user.nombre,
          tiempoPausado: tiempoPausadoReciente,
          fechaEstimadaFin: tarjeta.fechaEstimadaFin
        });
      }
    });
    
    // 🔥 NUEVO: Notificar al CLIENTE
    if (tarjeta.clienteInfo?.userId) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-reanudada-tiempo-real', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre
        });
      }
    }
    
    res.json({ 
      success: true, 
      tarjeta: tarjetaActualizada,
      tiempoPausado: tiempoPausadoReciente,
      fechaEstimadaFin: tarjeta.fechaEstimadaFin
    });
  } catch (error) {
    console.error('❌ Error en reanudar:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT - CALIFICAR TAREA
// ============================================================

router.put('/:id/calificar', protect, async (req, res) => {
  try {
    const { puntaje, comentario } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'finalizada') {
      return res.status(400).json({ message: 'Esta tarea aún no ha sido finalizada' });
    }
    
    if (tarjeta.clienteInfo.userId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No puedes calificar esta tarea' });
    }
    
    if (tarjeta.calificacion?.puntaje) {
      return res.status(400).json({ message: 'Esta tarea ya ha sido calificada' });
    }
    
    tarjeta.calificacion = {
      puntaje,
      comentario: comentario || '',
      fecha: new Date(),
      clienteId: req.user._id
    };
    tarjeta.estadoCalificacion = 'calificada';
    
    await tarjeta.save();
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_finalizada',
      por: req.user.nombre,
      rol: 'usuario',
      motivo: `Tarea calificada con ${puntaje} estrellas`
    });
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    if (tarjeta.asignadoA) {
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