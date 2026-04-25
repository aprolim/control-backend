import express from 'express';
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';
import { protect, jefeOnly, empleadoOrJefe } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para calcular progreso basado en tiempo acumulado
const calcularProgresoPorTiempo = (tarjeta) => {
  if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
    return { porcentaje: tarjeta.porcentajeCompletado, tiempoTranscurrido: 0, tiempoRestante: 0 };
  }
  
  let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
  
  // Si está activa, sumar el tiempo desde la última reanudación
  if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
    const ahora = new Date();
    const inicio = new Date(tarjeta.fechaUltimaReanudacion);
    const segundosTranscurridos = Math.floor((ahora - inicio) / 1000);
    const minutosTranscurridos = Math.floor(segundosTranscurridos / 60);
    tiempoTotalTrabajado += minutosTranscurridos;
  }
  
  const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
  let porcentaje = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
  porcentaje = Math.max(porcentaje, tarjeta.porcentajeCompletado);
  porcentaje = Math.min(100, porcentaje);
  const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
  
  return {
    porcentaje,
    tiempoTranscurrido: tiempoTotalTrabajado,
    tiempoRestante
  };
};

// Obtener todas las tarjetas del usuario
router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    
    if (req.user.rol === 'empleado') {
      query = { asignadoA: req.user._id };
    } else if (req.user.rol === 'cliente') {
      query = { 'clienteInfo.userId': req.user._id };
    }
    
    const tarjetas = await Tarjeta.find(query)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre')
      .sort('-createdAt');
    
    res.json(tarjetas);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener tareas disponibles para tomar (solo empleados y jefes)
router.get('/disponibles', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
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
    res.status(500).json({ message: error.message });
  }
});

// Obtener estado en tiempo real de todos los empleados
router.get('/estado-empleados', protect, async (req, res) => {
  try {
    if (req.user.rol === 'cliente') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const empleadosConTareas = await User.find({ 
      rol: 'empleado', 
      activo: true 
    }).select('nombre email');
    
    let jefeConTarea = null;
    if (req.user.rol === 'jefe') {
      const tareaJefeActiva = await Tarjeta.findOne({
        asignadoA: req.user._id,
        estado: 'en_progreso',
        estadoProgreso: 'activa'
      }).populate('asignadoA', 'nombre email');
      
      if (tareaJefeActiva) {
        const { porcentaje, tiempoTranscurrido, tiempoRestante } = calcularProgresoPorTiempo(tareaJefeActiva);
        
        jefeConTarea = {
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre,
          empleadoEmail: req.user.email,
          rol: 'jefe',
          tarea: {
            id: tareaJefeActiva._id,
            titulo: tareaJefeActiva.titulo,
            descripcion: tareaJefeActiva.descripcion,
            porcentajeCompletado: porcentaje,
            tiempoEstimado: tareaJefeActiva.tiempoEstimadoEmpleado || 0,
            tiempoTranscurrido: tiempoTranscurrido,
            tiempoRestante: tiempoRestante,
            fechaInicio: tareaJefeActiva.fechaInicioReal,
            fechaEstimadaFin: tareaJefeActiva.fechaEstimadaFin,
            estadoProgreso: tareaJefeActiva.estadoProgreso,
            estado: tareaJefeActiva.estado
          }
        };
      }
    }
    
    const estados = [];
    
    for (const empleado of empleadosConTareas) {
      const tareaActiva = await Tarjeta.findOne({
        asignadoA: empleado._id,
        estado: 'en_progreso',
        estadoProgreso: 'activa'
      }).populate('asignadoA', 'nombre email');
      
      if (tareaActiva) {
        const { porcentaje, tiempoTranscurrido, tiempoRestante } = calcularProgresoPorTiempo(tareaActiva);
        
        estados.push({
          empleadoId: empleado._id,
          empleadoNombre: empleado.nombre,
          empleadoEmail: empleado.email,
          rol: 'empleado',
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
          empleadoId: empleado._id,
          empleadoNombre: empleado.nombre,
          empleadoEmail: empleado.email,
          rol: 'empleado',
          tarea: null
        });
      }
    }
    
    if (jefeConTarea) {
      estados.push(jefeConTarea);
    }
    
    res.json(estados);
  } catch (error) {
    console.error('Error en estado-empleados:', error);
    res.status(500).json({ message: error.message });
  }
});

// Obtener progreso automático de una tarea activa (con logs detallados)
router.get('/:id/progreso-automatico', protect, async (req, res) => {
  try {
    console.log('========================================');
    console.log('🔍 [PROGRESO-AUTOMATICO] Iniciando...');
    console.log(`📌 Tarea ID: ${req.params.id}`);
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`⏰ Hora actual: ${new Date().toLocaleTimeString()}`);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    console.log('📋 DATOS DE LA TAREA EN BD:');
    console.log(`   - Título: ${tarjeta.titulo}`);
    console.log(`   - Estado: ${tarjeta.estado}`);
    console.log(`   - EstadoProgreso: ${tarjeta.estadoProgreso}`);
    console.log(`   - PorcentajeCompletado (BD): ${tarjeta.porcentajeCompletado}%`);
    console.log(`   - TiempoEstimadoEmpleado: ${tarjeta.tiempoEstimadoEmpleado} min`);
    console.log(`   - TiempoAcumulado: ${tarjeta.tiempoAcumulado || 0} min`);
    console.log(`   - FechaInicioReal: ${tarjeta.fechaInicioReal}`);
    console.log(`   - FechaUltimaReanudacion: ${tarjeta.fechaUltimaReanudacion}`);
    
    // Si la tarea ya está en revisión o completada, no calcular progreso
    if (tarjeta.estado !== 'en_progreso') {
      console.log(`⏭️ Tarea ya no está en progreso. Estado actual: ${tarjeta.estado}`);
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        estaActiva: false,
        estado: tarjeta.estado,
        mensaje: tarjeta.estado === 'revision_jefe' ? 'Tarea en revisión' : ''
      });
    }
    
    // Solo calcular si la tarea está activa y tiene tiempo estimado
    if (tarjeta.estadoProgreso !== 'activa') {
      console.log(`⏸️ Tarea no está activa. EstadoProgreso: ${tarjeta.estadoProgreso}`);
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: tarjeta.tiempoEstimadoEmpleado || 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
      console.log(`⚠️ Tarea sin tiempo estimado: ${tarjeta.tiempoEstimadoEmpleado}`);
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    // CALCULAR TIEMPO TRANSCURRIDO
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    let minutosDesdeReanudacion = 0;
    let segundosDesdeReanudacion = 0;
    
    if (tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      segundosDesdeReanudacion = Math.floor((ahora - inicio) / 1000);
      minutosDesdeReanudacion = Math.floor(segundosDesdeReanudacion / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
      
      console.log('⏱️ CÁLCULO DE TIEMPO:');
      console.log(`   - Acumulado previo: ${tarjeta.tiempoAcumulado || 0} min`);
      console.log(`   - Segundos desde reanudación: ${segundosDesdeReanudacion} seg`);
      console.log(`   - Minutos desde reanudación: ${minutosDesdeReanudacion} min`);
      console.log(`   - Total trabajado: ${tiempoTotalTrabajado} min`);
    } else {
      console.log('⚠️ No hay fechaUltimaReanudacion, no se puede calcular tiempo transcurrido');
    }
    
    const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
    let porcentajeCalculado = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
    porcentajeCalculado = Math.max(porcentajeCalculado, tarjeta.porcentajeCompletado);
    porcentajeCalculado = Math.min(100, porcentajeCalculado);
    const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
    
    console.log('📊 RESULTADO DEL CÁLCULO:');
    console.log(`   - Porcentaje calculado: ${porcentajeCalculado}%`);
    console.log(`   - Tiempo restante: ${tiempoRestante} min`);
    console.log(`   - Tiempo transcurrido: ${tiempoTotalTrabajado} min`);
    
    let estadoActualizado = tarjeta.estado;
    let mensaje = '';
    let tareaActualizada = null;
    let huboCambio = false;
    
    // ✅ SI EL PROGRESO LLEGA AL 100% O EL TIEMPO RESTANTE ES 0, CAMBIAR A REVISIÓN
    if ((porcentajeCalculado >= 100 || tiempoRestante <= 0) && tarjeta.estado === 'en_progreso') {
      console.log('🎉 ¡TIEMPO CUMPLIDO! Cambiando tarea a revisión...');
      console.log(`   - Porcentaje: ${porcentajeCalculado}%`);
      console.log(`   - Tiempo restante: ${tiempoRestante} min`);
      
      estadoActualizado = 'revision_jefe';
      tarjeta.estado = 'revision_jefe';
      tarjeta.fechaCompletadaEmpleado = new Date();
      tarjeta.fechaRevisionJefe = new Date();
      tarjeta.revisionJefe = 'pendiente';
      tarjeta.fechaExpiracionRevisionJefe = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tarjeta.estadoProgreso = 'completada';
      tarjeta.porcentajeCompletado = 100;
      huboCambio = true;
      mensaje = '✅ Tarea completada. Enviada a revisión del jefe.';
      
      console.log('💾 Guardando cambios en BD...');
      await tarjeta.save();
      console.log('✅ Cambios guardados en BD');
      
      tareaActualizada = await Tarjeta.findById(req.params.id)
        .populate('asignadoA', 'nombre email')
        .populate('asignadoPor', 'nombre');
      
      // Notificar a los jefes
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const jefes = await User.find({ rol: 'jefe', activo: true }).select('_id');
      console.log(`📢 Notificando a ${jefes.length} jefes...`);
      jefes.forEach(jefe => {
        const socket = clients.get(jefe._id.toString());
        if (socket) {
          socket.emit('tarea-lista-para-revision', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            empleadoId: req.user._id,
            empleadoNombre: req.user.nombre
          });
          console.log(`   - Notificado a jefe: ${jefe._id}`);
        }
      });
      
      // Notificar al empleado
      const socketEmpleado = clients.get(tarjeta.asignadoA?.toString());
      if (socketEmpleado) {
        socketEmpleado.emit('tarea-completada-automaticamente', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: '¡Tarea completada! Ha sido enviada a revisión del jefe.'
        });
        console.log(`   - Notificado al empleado: ${tarjeta.asignadoA}`);
      }
    } else if (porcentajeCalculado > tarjeta.porcentajeCompletado) {
      console.log(`📈 Actualizando porcentaje de ${tarjeta.porcentajeCompletado}% a ${porcentajeCalculado}%`);
      tarjeta.porcentajeCompletado = porcentajeCalculado;
      await tarjeta.save();
      tareaActualizada = tarjeta;
      huboCambio = true;
    } else {
      console.log('⏸️ Sin cambios en el porcentaje');
      tareaActualizada = tarjeta;
    }
    
    // Si hubo cambio, emitir evento de actualización general
    if (huboCambio) {
      console.log('📢 Emitiendo evento de actualización general...');
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const todosUsuarios = await User.find({ activo: true }).select('_id');
      todosUsuarios.forEach(usuario => {
        const socket = clients.get(usuario._id.toString());
        if (socket) {
          socket.emit('estado-general-actualizado', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            estado: tarjeta.estado,
            porcentaje: tarjeta.porcentajeCompletado
          });
        }
      });
      console.log(`   - Notificados ${todosUsuarios.length} usuarios`);
    }
    
    console.log('✅ [PROGRESO-AUTOMATICO] Finalizado');
    console.log('========================================\n');
    
    res.json({
      porcentajeCalculado,
      tiempoTranscurrido: tiempoTotalTrabajado,
      tiempoRestante,
      estado: estadoActualizado,
      mensaje,
      estaActiva: true,
      tiempoEstimado,
      fechaInicio: tarjeta.fechaInicioReal,
      fechaEstimadaFin: tarjeta.fechaEstimadaFin,
      tarea: tareaActualizada,
      huboCambio
    });
  } catch (error) {
    console.error('❌ Error en progreso-automatico:', error);
    res.status(500).json({ message: error.message });
  }
});

// Obtener una tarjeta específica
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
    res.status(500).json({ message: error.message });
  }
});

// Crear solicitud de cliente
router.post('/', protect, async (req, res) => {
  try {
    const { titulo, descripcion, horasEstimadas, clienteInfo } = req.body;
    
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
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuarios = await User.find({ 
      rol: { $in: ['empleado', 'jefe'] }, 
      activo: true 
    }).select('_id');
    
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
    res.status(500).json({ message: error.message });
  }
});

// Crear tarea extra
router.post('/tarea-extra', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
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
    res.status(500).json({ message: error.message });
  }
});

// Auto-asignar tarea
router.put('/:id/auto-asignar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
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
      rol: { $in: ['empleado', 'jefe'] }, 
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
    res.status(500).json({ message: error.message });
  }
});

// Tomar siguiente tarea disponible
router.put('/tomar-siguiente', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
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
      rol: { $in: ['empleado', 'jefe'] }, 
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
    res.status(500).json({ message: error.message });
  }
});

// Tomar una tarea específica
router.put('/:id/tomar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
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
      rol: { $in: ['empleado', 'jefe'] }, 
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
    res.status(500).json({ message: error.message });
  }
});

// Asignar por jefe
router.put('/:id/asignar-jefe', protect, jefeOnly, async (req, res) => {
  try {
    const { empleadoId, tiempoSugeridoHoras, tiempoSugeridoMinutos } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    const empleado = await User.findById(empleadoId);
    
    if (!tarjeta || !empleado) {
      return res.status(404).json({ message: 'Tarea o empleado no encontrado' });
    }
    
    tarjeta.asignadoA = empleadoId;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'jefe';
    tarjeta.estado = 'en_progreso';
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaInicio = new Date();
    tarjeta.tiempoAcumulado = 0;
    tarjeta.fechaUltimaReanudacion = null;
    
    const ultimaTarea = await Tarjeta.findOne({ 
      asignadoA: empleadoId,
      estado: 'en_progreso'
    }).sort({ ordenCola: -1 });
    
    tarjeta.ordenCola = (ultimaTarea?.ordenCola || 0) + 1;
    
    if (tiempoSugeridoHoras || tiempoSugeridoMinutos) {
      const horas = Math.min(23, Math.max(0, parseInt(tiempoSugeridoHoras) || 0));
      const minutos = Math.min(59, Math.max(0, parseInt(tiempoSugeridoMinutos) || 0));
      tarjeta.tiempoSugeridoJefe = (horas * 60) + minutos;
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
    
    res.json(tarjetaActualizada);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Registrar progreso
router.put('/:id/progreso', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { horasTrabajadas, minutosTrabajados, porcentajeAvance, comentario, inicioTrabajo, finTrabajo, cruzoMedianoche, esHoraExtra } = req.body;
    
    const tiempoTotalMinutos = (horasTrabajadas || 0) * 60 + (minutosTrabajados || 0);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const registro = {
      fecha: new Date(),
      horasTrabajadas: tiempoTotalMinutos / 60,
      minutosTrabajados: minutosTrabajados || 0,
      porcentajeAvance: parseInt(porcentajeAvance),
      comentario: comentario || '',
      inicioTrabajo: inicioTrabajo ? new Date(inicioTrabajo) : new Date(),
      finTrabajo: finTrabajo ? new Date(finTrabajo) : new Date(),
      cruzoMedianoche: cruzoMedianoche || false,
      esHoraExtra: esHoraExtra || false
    };
    
    tarjeta.registroHoras.push(registro);
    tarjeta.porcentajeCompletado = parseInt(porcentajeAvance);
    
    const horasActuales = tarjeta.horasTotalesReales || 0;
    const minutosActuales = tarjeta.minutosTotalesReales || 0;
    const totalMinutosActuales = (horasActuales * 60) + minutosActuales;
    const nuevosTotalMinutos = totalMinutosActuales + tiempoTotalMinutos;
    
    tarjeta.horasTotalesReales = Math.floor(nuevosTotalMinutos / 60);
    tarjeta.minutosTotalesReales = nuevosTotalMinutos % 60;
    
    // Actualizar tiempo acumulado si la tarea está activa
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tarjeta.tiempoAcumulado = (tarjeta.tiempoAcumulado || 0) + minutosDesdeReanudacion;
      tarjeta.fechaUltimaReanudacion = ahora;
    }
    
    if (esHoraExtra && req.user.rol !== 'jefe') {
      tarjeta.tolerancias.push({
        fecha: new Date(),
        motivo: `Horas extras trabajadas: ${horasTrabajadas}h ${minutosTrabajados || 0}min`,
        horasExtras: horasTrabajadas || 0,
        minutosExtras: minutosTrabajados || 0,
        estado: 'pendiente'
      });
    }
    
    if (parseInt(porcentajeAvance) >= 100 && tarjeta.estado === 'en_progreso') {
      console.log(`✅ Tarea completada por registro manual: ${tarjeta.titulo}`);
      tarjeta.fechaCompletadaEmpleado = new Date();
      tarjeta.estado = 'revision_jefe';
      tarjeta.fechaRevisionJefe = new Date();
      tarjeta.revisionJefe = 'pendiente';
      tarjeta.fechaExpiracionRevisionJefe = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tarjeta.estadoProgreso = 'completada';
      
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const jefes = await User.find({ rol: 'jefe', activo: true }).select('_id');
      jefes.forEach(jefe => {
        const socket = clients.get(jefe._id.toString());
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
      rol: { $in: ['jefe', 'empleado'] }, 
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
    res.status(500).json({ message: error.message });
  }
});

// Establecer tiempo estimado
router.put('/:id/tiempo-estimado', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { tiempoEstimadoHoras, tiempoEstimadoMinutos } = req.body;
    
    const horas = Math.min(23, Math.max(0, parseInt(tiempoEstimadoHoras) || 0));
    const minutos = Math.min(59, Math.max(0, parseInt(tiempoEstimadoMinutos) || 0));
    const tiempoTotalMinutos = (horas * 60) + minutos;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    tarjeta.tiempoEstimadoEmpleado = tiempoTotalMinutos;
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoTotalMinutos * 60 * 1000);
    
    await tarjeta.save();
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['jefe', 'empleado'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tiempo-estimado-actualizado', {
          tareaId: tarjeta._id,
          empleadoId: req.user._id,
          empleadoNombre: req.user.nombre,
          tiempoEstimado: tiempoTotalMinutos,
          fechaEstimadaFin: tarjeta.fechaEstimadaFin
        });
      }
    });
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Iniciar tarea
router.put('/:id/iniciar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { tiempoEstimadoHoras, tiempoEstimadoMinutos } = req.body;
    const tiempoTotalMinutos = (tiempoEstimadoHoras || 0) * 60 + (tiempoEstimadoMinutos || 0);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // Pausar cualquier otra tarea activa del usuario
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa', _id: { $ne: req.params.id } },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    tarjeta.tiempoEstimadoEmpleado = tiempoTotalMinutos;
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoTotalMinutos * 60 * 1000);
    tarjeta.fechaInicioReal = new Date();
    tarjeta.fechaUltimaReanudacion = new Date();
    tarjeta.estadoProgreso = 'activa';
    tarjeta.estado = 'en_progreso';
    tarjeta.tiempoAcumulado = 0;
    
    await tarjeta.save();
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    console.log(`🚀 Tarea iniciada: ${tarjetaActualizada.titulo}`);
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['jefe', 'empleado'] }, 
      activo: true 
    }).select('_id');
    
    usuariosNotificar.forEach(usuario => {
      const socket = clients.get(usuario._id.toString());
      if (socket) {
        socket.emit('tarea-iniciada-tiempo-real', {
          tarea: {
            id: tarjeta._id,
            titulo: tarjeta.titulo,
            tiempoEstimado: tiempoTotalMinutos,
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
    console.error('❌ Error en iniciar tarea:', error);
    res.status(500).json({ message: error.message });
  }
});

// Pausar tarea
router.put('/:id/pausar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // Guardar tiempo trabajado hasta ahora
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosTrabajados = Math.floor((ahora - inicio) / 1000 / 60);
      tarjeta.tiempoAcumulado = (tarjeta.tiempoAcumulado || 0) + minutosTrabajados;
    }
    
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaUltimaReanudacion = null;
    await tarjeta.save();
    
    console.log(`⏸️ Tarea pausada: ${tarjeta.titulo}`);
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['jefe', 'empleado'] }, 
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
    res.status(500).json({ message: error.message });
  }
});

// Reanudar tarea
router.put('/:id/reanudar', protect, async (req, res) => {
  try {
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // Pausar cualquier otra tarea activa del usuario
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa' },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    // Reanudar esta tarea
    tarjeta.estadoProgreso = 'activa';
    tarjeta.fechaUltimaReanudacion = new Date();
    await tarjeta.save();
    
    console.log(`▶️ Tarea reanudada: ${tarjeta.titulo}`);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuariosNotificar = await User.find({ 
      rol: { $in: ['jefe', 'empleado'] }, 
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

// Aprobar tarea (jefe)
router.put('/:id/aprobar-jefe', protect, jefeOnly, async (req, res) => {
  try {
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'revision_jefe') {
      return res.status(400).json({ message: 'Esta tarea no está pendiente de aprobación' });
    }
    
    tarjeta.revisionJefe = 'aprobada';
    tarjeta.estado = 'revision_cliente';
    tarjeta.fechaRevisionCliente = new Date();
    tarjeta.estadoCalificacion = 'pendiente';
    tarjeta.fechaExpiracionCalificacion = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await tarjeta.save();
    
    if (tarjeta.clienteInfo?.userId) {
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-lista-para-calificar', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo
        });
      }
    }
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Calificar tarea (cliente)
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
    res.status(500).json({ message: error.message });
  }
});

export default router;