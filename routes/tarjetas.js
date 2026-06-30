import express from 'express';
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';
import { protect, jefeOnly, empleadoOrJefe } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// FUNCIÓN AUXILIAR: Calcular progreso por tiempo
// ============================================================
const calcularProgresoPorTiempo = (tarjeta) => {
  console.log('⏱️ [CALCULAR-PROGRESO] Iniciando cálculo...');
  console.log(`   - Tarea: ${tarjeta.titulo}`);
  console.log(`   - EstadoProgreso: ${tarjeta.estadoProgreso}`);
  console.log(`   - TiempoEstimado: ${tarjeta.tiempoEstimadoEmpleado}`);
  console.log(`   - TiempoAcumulado: ${tarjeta.tiempoAcumulado || 0}`);
  console.log(`   - FechaUltimaReanudacion: ${tarjeta.fechaUltimaReanudacion}`);
  
  if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
    console.log('   ⚠️ Sin tiempo estimado, retornando progreso actual');
    return {
      porcentaje: tarjeta.porcentajeCompletado,
      tiempoTranscurrido: 0,
      tiempoRestante: 0
    };
  }
  
  let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
  let minutosDesdeReanudacion = 0;
  
  if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
    const ahora = new Date();
    const inicio = new Date(tarjeta.fechaUltimaReanudacion);
    minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
    tiempoTotalTrabajado += minutosDesdeReanudacion;
    console.log(`   - Minutos desde reanudación: ${minutosDesdeReanudacion}`);
  }
  
  const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
  let porcentaje = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
  porcentaje = Math.max(porcentaje, tarjeta.porcentajeCompletado);
  porcentaje = Math.min(100, porcentaje);
  const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
  
  console.log(`   📊 RESULTADO:`);
  console.log(`   - Porcentaje: ${porcentaje}%`);
  console.log(`   - TiempoTotalTrabajado: ${tiempoTotalTrabajado} min`);
  console.log(`   - TiempoRestante: ${tiempoRestante} min`);
  
  return {
    porcentaje,
    tiempoTranscurrido: tiempoTotalTrabajado,
    tiempoRestante
  };
};

// ============================================================
// GET: Obtener todas las tarjetas del usuario
// ============================================================
router.get('/', protect, async (req, res) => {
  try {
    console.log('========================================');
    console.log('📋 [GET-TARJETAS] Solicitando tarjetas...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`🆔 ID: ${req.user._id}`);
    
    let query = {};
    
    if (req.user.rol === 'empleado') {
      console.log('   🔍 Filtro: empleado -> asignadoA');
      query = { asignadoA: req.user._id };
    } else if (req.user.rol === 'jefe') {
      console.log('   🔍 Filtro: jefe -> TODAS las tareas');
      query = {};
    } else if (req.user.rol === 'cliente') {
      console.log('   🔍 Filtro: cliente -> clienteInfo.userId O asignadoA');
      query = {
        $or: [
          { 'clienteInfo.userId': req.user._id },
          { asignadoA: req.user._id }
        ]
      };
    }
    
    console.log(`   📝 Query: ${JSON.stringify(query)}`);
    
    const tarjetas = await Tarjeta.find(query)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre')
      .sort('-createdAt');
    
    console.log(`   ✅ Encontradas ${tarjetas.length} tarjetas`);
    if (tarjetas.length > 0) {
      tarjetas.forEach(t => {
        console.log(`      - ${t.titulo} (${t.estado}) - asignadoA: ${t.asignadoA?.nombre || 'N/A'}`);
      });
    }
    console.log('========================================\n');
    
    res.json(tarjetas);
  } catch (error) {
    console.error('❌ Error en GET /tarjetas:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// GET: Tareas disponibles para tomar
// ============================================================
router.get('/disponibles', protect, async (req, res) => {
  try {
    console.log('📋 [GET-DISPONIBLES] Buscando tareas disponibles...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('   ❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tareasDisponibles = await Tarjeta.find({
      estado: 'pendiente',
      asignadoA: null,
      tipo: 'solicitud_cliente'
    })
      .sort({ prioridad: -1, createdAt: 1 })
      .limit(20);
    
    console.log(`   ✅ Encontradas ${tareasDisponibles.length} tareas disponibles`);
    res.json(tareasDisponibles);
  } catch (error) {
    console.error('❌ Error en GET /disponibles:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// GET: Estado de empleados en tiempo real
// ============================================================
router.get('/estado-empleados', protect, async (req, res) => {
  try {
    console.log('👥 [ESTADO-EMPLEADOS] Solicitando estado...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    if (req.user.rol === 'cliente') {
      console.log('   ❌ Cliente no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const empleadosConTareas = await User.find({ 
      rol: 'empleado', 
      activo: true 
    }).select('nombre email');
    
    console.log(`   👷 Empleados encontrados: ${empleadosConTareas.length}`);
    
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
        console.log(`   👔 Jefe tiene tarea activa: ${tareaJefeActiva.titulo}`);
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
        console.log(`   👷 ${empleado.nombre}: tarea activa - ${tareaActiva.titulo}`);
      } else {
        estados.push({
          empleadoId: empleado._id,
          empleadoNombre: empleado.nombre,
          empleadoEmail: empleado.email,
          rol: 'empleado',
          tarea: null
        });
        console.log(`   👷 ${empleado.nombre}: sin tarea activa`);
      }
    }
    
    if (jefeConTarea) {
      estados.push(jefeConTarea);
    }
    
    console.log(`   ✅ Estado generado: ${estados.length} empleados`);
    res.json(estados);
  } catch (error) {
    console.error('❌ Error en estado-empleados:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// GET: Progreso automático de tarea activa
// ============================================================
router.get('/:id/progreso-automatico', protect, async (req, res) => {
  try {
    console.log('========================================');
    console.log('🔍 [PROGRESO-AUTOMATICO] Iniciando...');
    console.log(`📌 Tarea ID: ${req.params.id}`);
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    console.log(`📋 Tarea: ${tarjeta.titulo}`);
    console.log(`   - Estado: ${tarjeta.estado}`);
    console.log(`   - EstadoProgreso: ${tarjeta.estadoProgreso}`);
    console.log(`   - Porcentaje: ${tarjeta.porcentajeCompletado}%`);
    console.log(`   - TiempoEstimado: ${tarjeta.tiempoEstimadoEmpleado} min`);
    console.log(`   - TiempoAcumulado: ${tarjeta.tiempoAcumulado || 0} min`);
    
    if (tarjeta.estado !== 'en_progreso') {
      console.log(`   ⏭️ Tarea no está en progreso (${tarjeta.estado})`);
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        estaActiva: false,
        estado: tarjeta.estado,
        mensaje: tarjeta.estado === 'revision_jefe' ? 'Tarea en revisión' : ''
      });
    }
    
    if (tarjeta.estadoProgreso !== 'activa') {
      console.log(`   ⏸️ Tarea no está activa (${tarjeta.estadoProgreso})`);
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: tarjeta.tiempoEstimadoEmpleado || 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    if (!tarjeta.tiempoEstimadoEmpleado || tarjeta.tiempoEstimadoEmpleado <= 0) {
      console.log('   ⚠️ Sin tiempo estimado');
      return res.json({
        porcentajeCalculado: tarjeta.porcentajeCompletado,
        tiempoTranscurrido: 0,
        tiempoRestante: 0,
        estaActiva: false,
        estado: tarjeta.estado
      });
    }
    
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    let minutosDesdeReanudacion = 0;
    
    if (tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
      console.log(`⏱️ Tiempo desde reanudación: ${minutosDesdeReanudacion} min`);
    }
    
    const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado;
    let porcentajeCalculado = Math.min(100, Math.floor((tiempoTotalTrabajado / tiempoEstimado) * 100));
    porcentajeCalculado = Math.max(porcentajeCalculado, tarjeta.porcentajeCompletado);
    porcentajeCalculado = Math.min(100, porcentajeCalculado);
    const tiempoRestante = Math.max(0, tiempoEstimado - tiempoTotalTrabajado);
    
    console.log(`📊 RESULTADO:`);
    console.log(`   - Porcentaje calculado: ${porcentajeCalculado}%`);
    console.log(`   - Tiempo restante: ${tiempoRestante} min`);
    
    let estadoActualizado = tarjeta.estado;
    let mensaje = '';
    let tareaActualizada = null;
    let huboCambio = false;
    
    if ((porcentajeCalculado >= 100 || tiempoRestante <= 0) && tarjeta.estado === 'en_progreso') {
      console.log('🎉 ¡TIEMPO CUMPLIDO! Cambiando a revisión...');
      
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
      
      await tarjeta.save();
      
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
        }
      });
      
      const socketEmpleado = clients.get(tarjeta.asignadoA?.toString());
      if (socketEmpleado) {
        socketEmpleado.emit('tarea-completada-automaticamente', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: '¡Tarea completada! Ha sido enviada a revisión del jefe.'
        });
      }
    } else if (porcentajeCalculado > tarjeta.porcentajeCompletado) {
      console.log(`📈 Actualizando porcentaje: ${tarjeta.porcentajeCompletado}% → ${porcentajeCalculado}%`);
      tarjeta.porcentajeCompletado = porcentajeCalculado;
      await tarjeta.save();
      tareaActualizada = tarjeta;
      huboCambio = true;
    } else {
      console.log('⏸️ Sin cambios en el porcentaje');
      tareaActualizada = tarjeta;
    }
    
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

// ============================================================
// GET: Obtener una tarjeta específica
// ============================================================
router.get('/:id', protect, async (req, res) => {
  try {
    console.log(`📋 [GET-TARJETA] Solicitando tarea: ${req.params.id}`);
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    const tarjeta = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    console.log(`✅ Tarea encontrada: ${tarjeta.titulo}`);
    res.json(tarjeta);
  } catch (error) {
    console.error('❌ Error en GET /:id:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// POST: Crear solicitud de cliente
// ============================================================
router.post('/', protect, async (req, res) => {
  try {
    console.log('📝 [POST-TARJETA] Creando solicitud...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
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
    
    console.log(`✅ Solicitud creada: ${solicitud.titulo} (ID: ${solicitud._id})`);
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    
    const usuarios = await User.find({ 
      rol: { $in: ['empleado', 'jefe'] }, 
      activo: true 
    }).select('_id');
    
    console.log(`📢 Notificando a ${usuarios.length} usuarios...`);
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

// ============================================================
// POST: Crear tarea extra
// ============================================================
router.post('/tarea-extra', protect, async (req, res) => {
  try {
    console.log('📝 [POST-TAREA-EXTRA] Creando tarea extra...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado para crear tarea extra');
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
    
    console.log(`✅ Tarea extra creada: ${tareaExtra.titulo} (ID: ${tareaExtra._id})`);
    res.status(201).json(tareaExtra);
  } catch (error) {
    console.error('❌ Error en POST /tarea-extra:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Auto-asignar tarea
// ============================================================
router.put('/:id/auto-asignar', protect, async (req, res) => {
  try {
    console.log('🎯 [AUTO-ASIGNAR] Iniciando...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA) {
      console.log(`❌ Tarea ya asignada a: ${tarjeta.asignadoA}`);
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
    
    console.log(`✅ Tarea auto-asignada a ${req.user.email}`);
    
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
    console.error('❌ Error en auto-asignar:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Tomar siguiente tarea disponible
// ============================================================
router.put('/tomar-siguiente', protect, async (req, res) => {
  try {
    console.log('🎯 [TOMAR-SIGUIENTE] Iniciando...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarea = await Tarjeta.findOne({
      estado: 'pendiente',
      asignadoA: null,
      tipo: 'solicitud_cliente'
    }).sort({ prioridad: -1, createdAt: 1 });
    
    if (!tarea) {
      console.log('❌ No hay tareas disponibles');
      return res.status(404).json({ message: 'No hay tareas disponibles' });
    }
    
    console.log(`✅ Tarea encontrada: ${tarea.titulo}`);
    
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
    console.error('❌ Error en tomar-siguiente:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Tomar una tarea específica
// ============================================================
router.put('/:id/tomar', protect, async (req, res) => {
  try {
    console.log('🎯 [TOMAR-ESPECIFICA] Iniciando...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA) {
      console.log(`❌ Tarea ya asignada a: ${tarjeta.asignadoA}`);
      return res.status(400).json({ message: 'Tarea ya asignada' });
    }
    
    if (tarjeta.estado !== 'pendiente') {
      console.log(`❌ Tarea no está pendiente (${tarjeta.estado})`);
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
    
    console.log(`✅ Tarea asignada a ${req.user.email}`);
    
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
    console.error('❌ Error en tomar específica:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Asignar por jefe (CON VALIDACIÓN DE ROL)
// ============================================================
router.put('/:id/asignar-jefe', protect, jefeOnly, async (req, res) => {
  try {
    console.log('========================================');
    console.log('👔 [ASIGNAR-JEFE] Asignando tarea...');
    console.log(`👤 Jefe: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    console.log(`📌 Empleado ID: ${req.body.empleadoId}`);
    console.log(`⏱️ Tiempo sugerido: ${req.body.tiempoSugeridoHoras}h ${req.body.tiempoSugeridoMinutos}min`);
    
    const { empleadoId, tiempoSugeridoHoras, tiempoSugeridoMinutos } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    const empleado = await User.findById(empleadoId);
    if (!empleado) {
      console.log('❌ Empleado no encontrado');
      return res.status(404).json({ message: 'Empleado no encontrado' });
    }
    
    console.log(`   📋 Empleado encontrado: ${empleado.email} (${empleado.rol})`);
    
    // 🔥 VALIDAR que el usuario sea empleado
    if (empleado.rol !== 'empleado') {
      console.log(`❌ El usuario ${empleado.email} no es empleado (es ${empleado.rol})`);
      return res.status(400).json({ 
        success: false,
        message: `El usuario "${empleado.nombre}" no es un empleado. Solo se pueden asignar tareas a empleados.`
      });
    }
    
    tarjeta.asignadoA = empleadoId;
    tarjeta.asignadoPor = req.user._id;
    tarjeta.asignadaPor = 'jefe';
    tarjeta.estado = 'en_progreso';
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaInicio = new Date();
    tarjeta.tiempoAcumulado = 0;
    tarjeta.fechaUltimaReanudacion = null;
    
    if (tiempoSugeridoHoras || tiempoSugeridoMinutos) {
      const horas = Math.min(23, Math.max(0, parseInt(tiempoSugeridoHoras) || 0));
      const minutos = Math.min(59, Math.max(0, parseInt(tiempoSugeridoMinutos) || 0));
      tarjeta.tiempoSugeridoJefe = (horas * 60) + minutos;
      console.log(`   ⏱️ Tiempo sugerido: ${tarjeta.tiempoSugeridoJefe} min`);
    }
    
    await tarjeta.save();
    
    await User.findByIdAndUpdate(empleadoId, {
      $push: { tareasActivas: tarjeta._id }
    });
    
    console.log(`✅ Tarea asignada exitosamente a ${empleado.email}`);
    
    const tarjetaActualizada = await Tarjeta.findById(req.params.id)
      .populate('asignadoA', 'nombre email')
      .populate('asignadoPor', 'nombre');
    
    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const socket = clients.get(empleadoId);
    if (socket) {
      console.log(`📢 Notificando al empleado ${empleado.email}...`);
      socket.emit('nueva-tarea-asignada', {
        tarea: tarjetaActualizada,
        mensaje: `Nueva tarea asignada: ${tarjetaActualizada.titulo}`
      });
    }
    
    console.log('✅ [ASIGNAR-JEFE] Finalizado');
    console.log('========================================\n');
    
    res.json({ 
      success: true, 
      message: 'Tarea asignada exitosamente',
      tarea: tarjetaActualizada 
    });
  } catch (error) {
    console.error('❌ Error en asignar-jefe:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
});

// ============================================================
// PUT: Registrar progreso
// ============================================================
router.put('/:id/progreso', protect, async (req, res) => {
  try {
    console.log('📊 [PROGRESO] Registrando progreso...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { horasTrabajadas, minutosTrabajados, porcentajeAvance, comentario, inicioTrabajo, finTrabajo, cruzoMedianoche, esHoraExtra } = req.body;
    
    const tiempoTotalMinutos = (horasTrabajadas || 0) * 60 + (minutosTrabajados || 0);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el asignado: ${tarjeta.asignadoA} vs ${req.user._id}`);
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
    
    console.log(`✅ Progreso registrado: ${porcentajeAvance}%`);
    
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
    console.error('❌ Error en progreso:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Establecer tiempo estimado
// ============================================================
router.put('/:id/tiempo-estimado', protect, async (req, res) => {
  try {
    console.log('⏱️ [TIEMPO-ESTIMADO] Estableciendo tiempo...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { tiempoEstimadoHoras, tiempoEstimadoMinutos } = req.body;
    
    const horas = Math.min(999, Math.max(0, parseInt(tiempoEstimadoHoras) || 0));
    const minutos = Math.min(999, Math.max(0, parseInt(tiempoEstimadoMinutos) || 0));
    const tiempoTotalMinutos = (horas * 60) + minutos;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el asignado: ${tarjeta.asignadoA} vs ${req.user._id}`);
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // ✅ Solo permitir establecer tiempo si NO tiene tiempo estimado aún
    if (tarjeta.tiempoEstimadoEmpleado > 0) {
      console.log('❌ Ya tiene tiempo estimado establecido');
      return res.status(400).json({ 
        message: 'Ya tienes un tiempo estimado establecido. No puedes modificarlo después de iniciar la tarea.' 
      });
    }
    
    tarjeta.tiempoEstimadoEmpleado = tiempoTotalMinutos;
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoTotalMinutos * 60 * 1000);
    
    await tarjeta.save();
    
    console.log(`✅ Tiempo estimado establecido: ${tiempoTotalMinutos} min`);
    
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
    console.error('❌ Error en tiempo-estimado:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Iniciar tarea
// ============================================================
router.put('/:id/iniciar', protect, async (req, res) => {
  try {
    console.log('🚀 [INICIAR] Iniciando tarea...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const { tiempoEstimadoHoras, tiempoEstimadoMinutos } = req.body;
    const tiempoTotalMinutos = (tiempoEstimadoHoras || 0) * 60 + (tiempoEstimadoMinutos || 0);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el asignado: ${tarjeta.asignadoA} vs ${req.user._id}`);
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    // ✅ Verificar que tenga tiempo estimado
    if (tarjeta.tiempoEstimadoEmpleado === 0) {
      console.log('❌ No tiene tiempo estimado');
      return res.status(400).json({ 
        message: 'Debes establecer un tiempo estimado antes de iniciar la tarea.' 
      });
    }
    
    // Pausar cualquier otra tarea activa del usuario
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa', _id: { $ne: req.params.id } },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    tarjeta.fechaInicioReal = new Date();
    tarjeta.fechaUltimaReanudacion = new Date();
    tarjeta.estadoProgreso = 'activa';
    tarjeta.estado = 'en_progreso';
    
    await tarjeta.save();
    
    console.log(`✅ Tarea iniciada: ${tarjeta.titulo}`);
    
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

// ============================================================
// PUT: Pausar tarea
// ============================================================
router.put('/:id/pausar', protect, async (req, res) => {
  try {
    console.log('⏸️ [PAUSAR] Pausando tarea...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el asignado: ${tarjeta.asignadoA} vs ${req.user._id}`);
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosTrabajados = Math.floor((ahora - inicio) / 1000 / 60);
      tarjeta.tiempoAcumulado = (tarjeta.tiempoAcumulado || 0) + minutosTrabajados;
      console.log(`   ⏱️ Tiempo trabajado en esta sesión: ${minutosTrabajados} min`);
    }
    
    tarjeta.estadoProgreso = 'pausada';
    tarjeta.fechaUltimaReanudacion = null;
    await tarjeta.save();
    
    console.log(`✅ Tarea pausada: ${tarjeta.titulo}`);
    
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
    console.error('❌ Error en pausar:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Reanudar tarea
// ============================================================
router.put('/:id/reanudar', protect, async (req, res) => {
  try {
    console.log('▶️ [REANUDAR] Reanudando tarea...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    if (req.user.rol !== 'empleado' && req.user.rol !== 'jefe') {
      console.log('❌ Usuario no autorizado');
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.asignadoA?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el asignado: ${tarjeta.asignadoA} vs ${req.user._id}`);
      return res.status(403).json({ message: 'No autorizado' });
    }
    
    if (tarjeta.tiempoEstimadoEmpleado === 0) {
      console.log('⚠️ Tarea sin tiempo estimado, no se puede reanudar');
      return res.status(400).json({ 
        message: 'Debes establecer un tiempo estimado antes de reanudar' 
      });
    }
    
    await Tarjeta.updateMany(
      { asignadoA: req.user._id, estadoProgreso: 'activa' },
      { estadoProgreso: 'pausada', fechaUltimaReanudacion: null }
    );
    
    tarjeta.estadoProgreso = 'activa';
    tarjeta.fechaUltimaReanudacion = new Date();
    await tarjeta.save();
    
    console.log(`✅ Tarea reanudada: ${tarjeta.titulo}`);
    
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

// ============================================================
// PUT: Aprobar tarea (jefe) - CORREGIDO
// ============================================================
router.put('/:id/aprobar-jefe', protect, jefeOnly, async (req, res) => {
  try {
    console.log('========================================');
    console.log('✅ [APROBAR-JEFE] Aprobando tarea...');
    console.log(`👤 Jefe: ${req.user.email}`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'revision_jefe') {
      console.log(`❌ Tarea no está en revisión (${tarjeta.estado})`);
      return res.status(400).json({ message: 'Esta tarea no está pendiente de aprobación' });
    }
    
    // 🔥 LÓGICA CORREGIDA: Determinar si va a cliente o se finaliza
    const esSolicitudCliente = tarjeta.tipo === 'solicitud_cliente' && tarjeta.clienteInfo?.userId;
    
    console.log(`   📋 Tipo: ${tarjeta.tipo}`);
    console.log(`   👤 Cliente ID: ${tarjeta.clienteInfo?.userId || 'N/A'}`);
    console.log(`   📌 Es solicitud de cliente: ${esSolicitudCliente}`);
    
    // Aprobar revisión del jefe
    tarjeta.revisionJefe = 'aprobada';
    
    if (esSolicitudCliente) {
      // ✅ CASO 1: Solicitud de cliente → va a revisión del cliente
      console.log('   ➡️ Enviando a REVISIÓN CLIENTE');
      tarjeta.estado = 'revision_cliente';
      tarjeta.fechaRevisionCliente = new Date();
      tarjeta.estadoCalificacion = 'pendiente';
      tarjeta.fechaExpiracionCalificacion = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      
      // Notificar al cliente
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-lista-para-calificar', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo
        });
        console.log(`📢 Notificado al cliente: ${tarjeta.clienteInfo.userId}`);
      }
    } else {
      // ✅ CASO 2: Tarea extra o asignación de jefe → finalizar directamente
      console.log('   ➡️ Finalizando tarea DIRECTAMENTE (sin cliente)');
      tarjeta.estado = 'finalizada';
      tarjeta.fechaFinalizada = new Date();
      tarjeta.estadoCalificacion = 'no_aplica';
      
      // Notificar al empleado
      if (tarjeta.asignadoA) {
        const io = req.app.get('io');
        const clients = req.app.get('clients');
        const socketEmpleado = clients.get(tarjeta.asignadoA.toString());
        if (socketEmpleado) {
          socketEmpleado.emit('tarea-finalizada-sin-cliente', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: '✅ Tarea aprobada y finalizada'
          });
          console.log(`📢 Notificado al empleado: ${tarjeta.asignadoA}`);
        }
      }
    }
    
    await tarjeta.save();
    console.log(`✅ Tarea aprobada. Nuevo estado: ${tarjeta.estado}`);
    console.log('========================================\n');
    
    res.json({ 
      success: true, 
      message: esSolicitudCliente ? 'Tarea enviada a revisión del cliente' : 'Tarea finalizada',
      tarjeta 
    });
  } catch (error) {
    console.error('❌ Error en aprobar-jefe:', error);
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// PUT: Calificar tarea (cliente)
// ============================================================
router.put('/:id/calificar', protect, async (req, res) => {
  try {
    console.log('⭐ [CALIFICAR] Calificando tarea...');
    console.log(`👤 Usuario: ${req.user.email} (${req.user.rol})`);
    console.log(`📌 Tarea ID: ${req.params.id}`);
    
    const { puntaje, comentario } = req.body;
    
    const tarjeta = await Tarjeta.findById(req.params.id);
    if (!tarjeta) {
      console.log('❌ Tarea no encontrada');
      return res.status(404).json({ message: 'Tarea no encontrada' });
    }
    
    if (tarjeta.estado !== 'revision_cliente') {
      console.log(`❌ Tarea no está en revisión cliente (${tarjeta.estado})`);
      return res.status(400).json({ message: 'Esta tarea no está pendiente de calificación' });
    }
    
    if (tarjeta.clienteInfo.userId?.toString() !== req.user._id.toString()) {
      console.log(`❌ Usuario no es el cliente que solicitó: ${tarjeta.clienteInfo.userId} vs ${req.user._id}`);
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
    
    console.log(`✅ Tarea calificada con ${puntaje} estrellas`);
    
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
        console.log(`📢 Notificado al empleado ${tarjeta.asignadoA}`);
      }
    }
    
    res.json({ success: true, tarjeta });
  } catch (error) {
    console.error('❌ Error en calificar:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;