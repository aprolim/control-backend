// routes/configuracion.js
import express from 'express';
import User from '../models/User.js';
import { protect, supervisorOnly } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// AUTO-CIERRE (existente)
// ============================================================

router.get('/auto-cierre', protect, supervisorOnly, async (req, res) => {
  try {
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true })
      .select('configuracionAutoCierre nombre email');
    
    if (!supervisor) {
      return res.status(404).json({ message: 'No se encontró configuración del supervisor' });
    }
    
    const tecnicos = await User.find({ rol: 'tecnico', activo: true })
      .select('_id nombre email');
    
    res.json({
      configuracion: supervisor.configuracionAutoCierre || {
        revisarColumna: 'revision_cliente',
        diasMaximosCliente: 5,
        diasMaximosSupervisor: 3,
        accionAuto: 'finalizar',
        notificarAntesDias: 1,
        habilitado: true,
        excepcionesEmpleados: []
      },
      empleados: tecnicos,
      supervisorNombre: supervisor.nombre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/auto-cierre', protect, supervisorOnly, async (req, res) => {
  try {
    const {
      revisarColumna,
      diasMaximosCliente,
      diasMaximosSupervisor,
      accionAuto,
      notificarAntesDias,
      habilitado,
      excepcionesEmpleados
    } = req.body;
    
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true });
    
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor no encontrado' });
    }
    
    supervisor.configuracionAutoCierre = {
      revisarColumna: revisarColumna || 'revision_cliente',
      diasMaximosCliente: Math.min(30, Math.max(1, diasMaximosCliente || 5)),
      diasMaximosSupervisor: Math.min(15, Math.max(1, diasMaximosSupervisor || 3)),
      accionAuto: accionAuto || 'finalizar',
      notificarAntesDias: Math.min(5, Math.max(0, notificarAntesDias || 1)),
      habilitado: habilitado !== undefined ? habilitado : true,
      excepcionesEmpleados: excepcionesEmpleados || []
    };
    
    await supervisor.save();
    
    res.json({
      success: true,
      message: 'Configuración actualizada exitosamente',
      configuracion: supervisor.configuracionAutoCierre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/auto-cierre/estadisticas', protect, supervisorOnly, async (req, res) => {
  try {
    const Tarjeta = (await import('../models/Tarjeta.js')).default;
    
    const stats = await Tarjeta.aggregate([
      {
        $match: {
          'calificacion.autoFinalizada': true,
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            mes: { $month: '$createdAt' },
            año: { $year: '$createdAt' }
          },
          count: { $sum: 1 },
          porTipo: {
            $push: {
              tipo: '$calificacion.tipo',
              accion: '$calificacion.accion'
            }
          }
        }
      }
    ]);
    
    const supervisor = await User.findOne({ rol: 'supervisor' });
    
    res.json({
      totalAutoFinalizadas: stats.reduce((sum, s) => sum + s.count, 0),
      porMes: stats,
      configuracionActual: supervisor?.configuracionAutoCierre || {}
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// 🔥 NUEVO: NOTIFICACIONES (sonidos y visuales)
// ============================================================

// Obtener la configuración de notificaciones
router.get('/notificaciones', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('configuracionNotificaciones rol');
    
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    // Devolver la config del propio usuario
    // Si es supervisor, devuelve la suya (que es la plantilla global)
    // Si es técnico, devuelve la suya (que puede haber sido personalizada)
    const configDefault = {
      recordatorioPendientes: {
        habilitado: true,
        intervaloMinutos: 2,
        sonidoHabilitado: true,
        soloCuandoLibre: true
      },
      nuevaTareaPendiente: {
        habilitado: true,
        sonidoHabilitado: true
      },
      tareaAsignada: {
        habilitado: true,
        sonidoHabilitado: true
      },
      volumen: 0.5,
      silenciarHasta: null
    };
    
    res.json({
      success: true,
      configuracion: user.configuracionNotificaciones || configDefault,
      rol: user.rol
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Actualizar configuración (supervisor puede actualizar la global para todos)
router.put('/notificaciones', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    const {
      recordatorioPendientes,
      nuevaTareaPendiente,
      tareaAsignada,
      volumen,
      silenciarHasta
    } = req.body;
    
    // Validar y construir la nueva configuración
    const nuevaConfig = {
      recordatorioPendientes: {
        habilitado: recordatorioPendientes?.habilitado ?? true,
        intervaloMinutos: Math.min(30, Math.max(1, parseInt(recordatorioPendientes?.intervaloMinutos) || 2)),
        sonidoHabilitado: recordatorioPendientes?.sonidoHabilitado ?? true,
        soloCuandoLibre: recordatorioPendientes?.soloCuandoLibre ?? true
      },
      nuevaTareaPendiente: {
        habilitado: nuevaTareaPendiente?.habilitado ?? true,
        sonidoHabilitado: nuevaTareaPendiente?.sonidoHabilitado ?? true
      },
      tareaAsignada: {
        habilitado: tareaAsignada?.habilitado ?? true,
        sonidoHabilitado: tareaAsignada?.sonidoHabilitado ?? true
      },
      volumen: Math.min(1, Math.max(0, parseFloat(volumen) || 0.5)),
      silenciarHasta: silenciarHasta || null
    };
    
    user.configuracionNotificaciones = nuevaConfig;
    await user.save();
    
    console.log(`🔔 [Configuración] Notificaciones actualizadas para ${user.email} (rol: ${user.rol})`);
    
    // 🔥 Si es supervisor, actualizar TODOS los técnicos con la misma config base
    // (excepto volumen y silenciarHasta, que son personales)
    if (user.rol === 'supervisor') {
      const tecnicos = await User.find({ rol: 'tecnico', activo: true });
      
      for (const tecnico of tecnicos) {
        // Preservar volumen y silenciarHasta del técnico
        const volumenTecnico = tecnico.configuracionNotificaciones?.volumen ?? 0.5;
        const silenciarTecnico = tecnico.configuracionNotificaciones?.silenciarHasta ?? null;
        
        tecnico.configuracionNotificaciones = {
          ...nuevaConfig,
          volumen: volumenTecnico,
          silenciarHasta: silenciarTecnico
        };
        
        await tecnico.save();
      }
      
      console.log(`   📢 Propagado a ${tecnicos.length} técnicos`);
      
      // Notificar a todos los técnicos por socket que su config cambió
      const io = req.app.get('io');
      const clients = req.app.get('clients');
      
      tecnicos.forEach(tec => {
        const socket = clients.get(tec._id.toString());
        if (socket) {
          socket.emit('notificaciones-actualizadas', {
            configuracion: tec.configuracionNotificaciones
          });
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Configuración de notificaciones actualizada',
      configuracion: user.configuracionNotificaciones
    });
  } catch (error) {
    console.error('❌ Error actualizando notificaciones:', error);
    res.status(500).json({ message: error.message });
  }
});

// Silenciar notificaciones por X minutos (para técnicos y supervisores)
router.post('/notificaciones/silenciar', protect, async (req, res) => {
  try {
    const { minutos } = req.body;
    const minutosValidos = Math.min(480, Math.max(1, parseInt(minutos) || 30));
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    if (!user.configuracionNotificaciones) {
      user.configuracionNotificaciones = {};
    }
    
    user.configuracionNotificaciones.silenciarHasta = new Date(Date.now() + minutosValidos * 60 * 1000);
    await user.save();
    
    console.log(`🔕 [Notificaciones] ${user.email} silenció por ${minutosValidos} min`);
    
    res.json({
      success: true,
      message: `Notificaciones silenciadas por ${minutosValidos} minutos`,
      silenciarHasta: user.configuracionNotificaciones.silenciarHasta
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reactivar notificaciones (quitar silencio)
router.post('/notificaciones/reactivar', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    
    if (!user.configuracionNotificaciones) {
      user.configuracionNotificaciones = {};
    }
    
    user.configuracionNotificaciones.silenciarHasta = null;
    await user.save();
    
    console.log(`🔔 [Notificaciones] ${user.email} reactivó notificaciones`);
    
    res.json({
      success: true,
      message: 'Notificaciones reactivadas'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// SOLICITUDES PREDEFINIDAS (existente)
// ============================================================

router.get('/solicitudes-predefinidas', protect, supervisorOnly, async (req, res) => {
  try {
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true });
    
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor no encontrado' });
    }
    
    res.json({
      success: true,
      solicitudes: supervisor.solicitudesPredefinidas || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/solicitudes-predefinidas', protect, supervisorOnly, async (req, res) => {
  try {
    const { titulo, descripcion, prioridad } = req.body;
    
    if (!titulo || titulo.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'El título es obligatorio'
      });
    }
    
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true });
    
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor no encontrado' });
    }
    
    const existe = supervisor.solicitudesPredefinidas.some(
      s => s.titulo.toLowerCase() === titulo.trim().toLowerCase() && s.activo !== false
    );
    
    if (existe) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe una solicitud con ese título'
      });
    }
    
    supervisor.solicitudesPredefinidas.push({
      titulo: titulo.trim(),
      descripcion: descripcion || '',
      prioridad: prioridad || 'media',
      activo: true
    });
    
    await supervisor.save();
    
    const nueva = supervisor.solicitudesPredefinidas[supervisor.solicitudesPredefinidas.length - 1];
    
    res.status(201).json({
      success: true,
      message: 'Solicitud predefinida creada exitosamente',
      solicitud: nueva
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/solicitudes-predefinidas/:id', protect, supervisorOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, prioridad, activo } = req.body;
    
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true });
    
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor no encontrado' });
    }
    
    const index = supervisor.solicitudesPredefinidas.findIndex(
      s => s._id.toString() === id
    );
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }
    
    const solicitud = supervisor.solicitudesPredefinidas[index];
    
    if (titulo && titulo.trim() !== '') {
      solicitud.titulo = titulo.trim();
    }
    if (descripcion !== undefined) {
      solicitud.descripcion = descripcion;
    }
    if (prioridad) {
      solicitud.prioridad = prioridad;
    }
    if (activo !== undefined) {
      solicitud.activo = activo;
    }
    
    await supervisor.save();
    
    res.json({
      success: true,
      message: 'Solicitud actualizada exitosamente',
      solicitud
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/solicitudes-predefinidas/:id', protect, supervisorOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    const supervisor = await User.findOne({ rol: 'supervisor', activo: true });
    
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor no encontrado' });
    }
    
    const index = supervisor.solicitudesPredefinidas.findIndex(
      s => s._id.toString() === id
    );
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }
    
    supervisor.solicitudesPredefinidas[index].activo = false;
    
    await supervisor.save();
    
    res.json({
      success: true,
      message: 'Solicitud eliminada exitosamente'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;