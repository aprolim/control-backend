import express from 'express';
import User from '../models/User.js';
import { protect, jefeOnly } from '../middleware/auth.js';

const router = express.Router();

// Obtener configuración actual del jefe
router.get('/auto-cierre', protect, jefeOnly, async (req, res) => {
  try {
    const jefe = await User.findOne({ rol: 'jefe', activo: true })
      .select('configuracionAutoCierre nombre email');
    
    if (!jefe) {
      return res.status(404).json({ message: 'No se encontró configuración del jefe' });
    }
    
    // Obtener lista de empleados para excepciones
    const empleados = await User.find({ rol: 'empleado', activo: true })
      .select('_id nombre email');
    
    res.json({
      configuracion: jefe.configuracionAutoCierre || {
        revisarColumna: 'revision_cliente',
        diasMaximosCliente: 5,
        diasMaximosJefe: 3,
        accionAuto: 'finalizar',
        notificarAntesDias: 1,
        habilitado: true,
        excepcionesEmpleados: []
      },
      empleados: empleados,
      jefeNombre: jefe.nombre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Actualizar configuración de auto-cierre
router.put('/auto-cierre', protect, jefeOnly, async (req, res) => {
  try {
    const {
      revisarColumna,
      diasMaximosCliente,
      diasMaximosJefe,
      accionAuto,
      notificarAntesDias,
      habilitado,
      excepcionesEmpleados
    } = req.body;
    
    const jefe = await User.findOne({ rol: 'jefe', activo: true });
    
    if (!jefe) {
      return res.status(404).json({ message: 'Jefe no encontrado' });
    }
    
    // Actualizar configuración
    jefe.configuracionAutoCierre = {
      revisarColumna: revisarColumna || 'revision_cliente',
      diasMaximosCliente: Math.min(30, Math.max(1, diasMaximosCliente || 5)),
      diasMaximosJefe: Math.min(15, Math.max(1, diasMaximosJefe || 3)),
      accionAuto: accionAuto || 'finalizar',
      notificarAntesDias: Math.min(5, Math.max(0, notificarAntesDias || 1)),
      habilitado: habilitado !== undefined ? habilitado : true,
      excepcionesEmpleados: excepcionesEmpleados || []
    };
    
    await jefe.save();
    
    res.json({
      success: true,
      message: 'Configuración actualizada exitosamente',
      configuracion: jefe.configuracionAutoCierre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener estadísticas de auto-cierre
router.get('/auto-cierre/estadisticas', protect, jefeOnly, async (req, res) => {
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
      configuracionActual: (await User.findOne({ rol: 'jefe' })).configuracionAutoCierre
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;