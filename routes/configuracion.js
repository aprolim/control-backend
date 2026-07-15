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
    
    res.json({
      totalAutoFinalizadas: stats.reduce((sum, s) => sum + s.count, 0),
      porMes: stats,
      configuracionActual: (await User.findOne({ rol: 'supervisor' })).configuracionAutoCierre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// 🔥 SOLICITUDES PREDEFINIDAS
// ============================================================

// Obtener todas las solicitudes predefinidas del supervisor
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

// Crear una nueva solicitud predefinida
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
    
    // Verificar que no exista una solicitud con el mismo título
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
    
    // Obtener la solicitud recién creada
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

// Actualizar una solicitud predefinida
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

// Eliminar una solicitud predefinida (desactivar)
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
    
    // Desactivar en lugar de eliminar
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